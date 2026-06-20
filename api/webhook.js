const axios = require("axios");

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;

const shopifyAPI = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/2026-04`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    "Content-Type": "application/json",
  },
});

// Tag-safe string banao (spaces ko dash se replace karo, special chars hatao)
function makeTagSafe(value) {
  if (!value) return "Unknown";
  return value
    .toString()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-]/g, "");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ message: "Webhook receiver active" });
  }

  try {
    const order = req.body;
    console.log("Order received:", order.id);

    // Step 1 - Har line item ka VID + Vendor Name + Payment Status fetch karo
    const itemsWithVID = await Promise.all(
      order.line_items.map(async (item) => {
        const metaRes = await shopifyAPI.get(
          `/products/${item.product_id}/metafields.json`
        );
        const metas = metaRes.data.metafields;

        const vidMeta = metas.find(
          (m) => m.namespace === "custom" && m.key === "vid"
        );
        const vendorNameMeta = metas.find(
          (m) => m.namespace === "custom" && m.key === "vendor_name"
        );
        const paymentStatusMeta = metas.find(
          (m) => m.namespace === "custom" && m.key === "vendor_payment_status"
        );

        return {
          ...item,
          vid: vidMeta ? vidMeta.value : "NO_VID",
          vendorName: vendorNameMeta ? vendorNameMeta.value : "Unknown",
          paymentStatus: paymentStatusMeta ? paymentStatusMeta.value : "Unknown",
        };
      })
    );

    // Step 2 - VID ke basis pe group karo
    const vidGroups = {};
    itemsWithVID.forEach((item) => {
      if (!vidGroups[item.vid]) {
        vidGroups[item.vid] = [];
      }
      vidGroups[item.vid].push(item);
    });

    const vids = Object.keys(vidGroups);
    console.log("VIDs found:", vids);

    // Step 3 - Agar sirf ek VID hai to split mat karo
    if (vids.length <= 1) {
      console.log("Single VID - no splitting needed");
      return res.status(200).json({ message: "No split needed" });
    }

    // Step 4 - Har VID ke liye alag order banao
    for (const vid of vids) {
      const items = vidGroups[vid];

      const vendorName = items[0].vendorName;
      const paymentStatus = items[0].paymentStatus;

      const vendorTag = `Vendor-${makeTagSafe(vendorName)}`;
      const paymentTag = `Payment-${makeTagSafe(paymentStatus)}`;

      const newOrder = {
        order: {
          line_items: items.map((item) => ({
            variant_id: item.variant_id,
            quantity: item.quantity,
          })),
          customer: order.customer ? { id: order.customer.id } : undefined,
          financial_status: "pending",
          note: `Split from Order #${order.order_number} - VID: ${vid} - Vendor: ${vendorName} - Payment: ${paymentStatus}`,
          tags: `split-order, VID-${vid}, ${vendorTag}, ${paymentTag}`,
        },
      };

      if (order.shipping_address) {
        newOrder.order.shipping_address = order.shipping_address;
      }
      if (order.billing_address) {
        newOrder.order.billing_address = order.billing_address;
      }

      const createdOrder = await shopifyAPI.post("/orders.json", newOrder);
      const newOrderId = createdOrder.data.order.id;
      console.log(
        `New order created for VID ${vid} (${vendorTag}, ${paymentTag}):`,
        newOrderId
      );
    }

    // Step 5 - Original order cancel karo
    await shopifyAPI.post(`/orders/${order.id}/cancel.json`);
    console.log("Original order cancelled:", order.id);

    return res.status(200).json({
      message: "Orders split successfully",
      vids: vids,
    });
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    return res.status(500).json({ error: error.message });
  }
};
