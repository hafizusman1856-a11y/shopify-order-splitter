const axios = require("axios");

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;

const shopifyAPI = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/2024-01`,
  headers: {
    "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    "Content-Type": "application/json",
  },
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ message: "Webhook receiver active" });
  }

  try {
    const order = req.body;
    console.log("Order received:", order.id);

    // Step 1 - Har line item ka VID fetch karo
    const itemsWithVID = await Promise.all(
      order.line_items.map(async (item) => {
        const metaRes = await shopifyAPI.get(
          `/products/${item.product_id}/metafields.json`
        );

        const vidMeta = metaRes.data.metafields.find(
          (m) => m.namespace === "custom" && m.key === "vid"
        );

        return {
          ...item,
          vid: vidMeta ? vidMeta.value : "NO_VID",
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

      const newOrder = {
        order: {
          line_items: items.map((item) => ({
            variant_id: item.variant_id,
            quantity: item.quantity,
          })),
          customer: order.customer
            ? { id: order.customer.id }
            : undefined,
          shipping_address: order.shipping_address,
          billing_address: order.billing_address,
          financial_status: "pending",
          note: `Split from Order #${order.order_number} - VID: ${vid}`,
          tags: `split-order, VID-${vid}`,
        },
      };

      const createdOrder = await shopifyAPI.post("/orders.json", newOrder);
      console.log(
        `New order created for VID ${vid}:`,
        createdOrder.data.order.id
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
}
