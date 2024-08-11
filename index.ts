import express from "express";
import { processMessage, receiveMessages } from "./aws";

const app = express();

const PORT = process.env.PORT || 8000;

async function processMessages() {
	// console.log("========================processing another batch========================");
  const messages = await receiveMessages();

  if (messages) {
    for (const message of messages) {
      await processMessage(message);
    }
  }
}

setInterval(processMessages, 10000); 
app.get("/", (req:any, res: any) => {
  res.sendStatus(200);
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
