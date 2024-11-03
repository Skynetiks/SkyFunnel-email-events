import { processMessage, receiveMessages } from "./aws";

async function processMessages() {
  console.log("Processing messages...");
  const messages = await receiveMessages();
  console.log("Messages received: " + JSON.stringify(messages?.length));
  if (messages) {
    for (const message of messages) {
      await processMessage(message);
    }
  }
}

// Run the cron job every 10 seconds
setInterval(() => {
  processMessages();
}, 10000);
