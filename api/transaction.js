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

async function generateTransactionNumber(orderId) {
  try {
    const ordersRes = await shopifyAPI.get(
      `/orders.json?status=any&limit=250&fields=id,created_at`
    );
    const orders = ordersRes.data.orders;

    const today = new Date().toISOString().split("T")[0];

    let highestTxn = 1000;
    let lastOrderDate = null;

    for (const order of orders) {
      if (order.id === orderId) continue;

      const metaRes = await shopifyAPI.get(
        `/orders/${order.id}/metafields.json`
      );
      const metas = metaRes.data.metafields;

      const txnMeta = metas.find(
        (m) => m.namespace === "custom" && m.key === "transaction_number"
      );
      const dateMeta = metas.find(
        (m) => m.namespace === "custom" && m.key === "transaction_date"
      );

      if (txnMeta) {
        const txnNum = parseInt(txnMeta.value.replace("TXN-", ""));
        if (txnNum > highestTxn) {
          highestTxn = txnNum;
          lastOrderDate = dateMeta ? dateMeta.value : null;
        }
      }
    }

    let newTxnNumber;
    if (lastOrderDate === null) {
      newTxnNumber = 1001;
    } else if (lastOrderDate !== today) {
      newTxnNumber = highestTxn + 5000;
    } else {
      newTxnNumber = highestTxn + 1;
    }

    return { txnNumber: `TXN-${newTxnNumber}`, date: today };
  } catch (error) {
    console.error("TXN Generation Error:", error.message);
    return { 
      txnNumber: `TXN-1001`, 
      date: new Date().toISOString().split("T")[0] 
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ message: "Transaction Number API active" });
  }

  try {
    const order = req.body;
    console.log("Order received for TXN:", order.id);

    // Transaction Number Generate karo
    const { txnNumber, date } = await generateTransactionNumber(order.id);
    console.log("Generated TXN:", txnNumber);

    // Transaction Number save karo
    await shopifyAPI.post(`/orders/${order.id}/metafields.json`, {
      metafield: {
        namespace: "custom",
        key: "transaction_number",
        value: txnNumber,
        type: "single_line_text_field",
      },
    });

    // Transaction Date save karo
    await shopifyAPI.post(`/orders/${order.id}/metafields.json`, {
      metafield: {
        namespace: "custom",
        key: "transaction_date",
        value: date,
        type: "date",
      },
    });

    console.log("TXN saved successfully:", txnNumber);

    return res.status(200).json({
      message: "Transaction Number assigned successfully",
      transaction_number: txnNumber,
      date: date,
    });

  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    return res.status(500).json({ error: error.message });
  }
}
