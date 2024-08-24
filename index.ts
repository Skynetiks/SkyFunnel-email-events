import { processMessage, receiveMessages } from "./aws";

async function processMessages() {
  const messages = await receiveMessages();

  if (messages) {
    for (const message of messages) {
      await processMessage(message);
    }
  }
}

// Run the cron job every 10 seconds
setInterval(() => {
  console.log("Invoking processMessages...");
  processMessages();
}, 10000);
