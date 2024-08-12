import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import "dotenv/config";
import { Mail } from "./types";
import { query } from "./db";

const REGION = process.env.S3_REGION;
const QUEUE_URL = process.env.SQS_QUEUE_URL;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const VISIBILITY_TIMEOUT = 50; // in secs

if (!REGION || !QUEUE_URL || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
	throw new Error('Missing required environment variables');
}

const sqsClient = new SQSClient({
	region: REGION,
	credentials: {
		accessKeyId: AWS_ACCESS_KEY_ID,
		secretAccessKey: AWS_SECRET_ACCESS_KEY,
	},
})

export async function receiveMessages() {
	try {
		const data = await sqsClient.send(
			new ReceiveMessageCommand({
				QueueUrl: QUEUE_URL,
				MaxNumberOfMessages: 10,
				WaitTimeSeconds: 20,
				VisibilityTimeout: VISIBILITY_TIMEOUT,
			})
		);

		return data.Messages;
	} catch (error) {
		console.error('Error receiving messages from SQS:', error);
		return [];
	}
}

export async function deleteMessage(receiptHandle: string) {
	try {
		await sqsClient.send(
			new DeleteMessageCommand({
				QueueUrl: QUEUE_URL,
				ReceiptHandle: receiptHandle,
			})
		);
	} catch (error) {
		console.error('Error deleting message from SQS:', error);
	}
}

export async function processMessage(message: any) {
	if (message.Body) {
		const body = JSON.parse(message.Body);

		const eventType = body.eventType;

		if (["Bounce", "Click", "Open", "Reject", "Complaint"].includes(eventType)) {
			// console.log(`Processing ${eventType} event:`, body.mail.destination[0]);

			const mail = body.mail as Mail;
			const { messageId, timestamp, destination } = mail;
			// console.log('Message ID:', messageId);
			// console.log('Timestamp:', timestamp);
			// console.log('Destination:', destination);

			const eventTypeUpper = eventType.toUpperCase();

			try {
				const result = await query('SELECT * FROM "Email" WHERE "awsMessageId" = $1', [messageId]);
				const email = result.rows[0];
				// console.log(email);
				if (!email) {
					console.log(`Email with message ID ${messageId} does not exist in the Email table.`);
					await deleteMessage(message.ReceiptHandle!);
					return;
				}

				// console.log("Inserting into EmailEvent...");
				await query('INSERT INTO "EmailEvent" ("id", "emailId", "eventType", "timestamp", "campaignId") VALUES (uuid_generate_v4(), $1, $2, $3, $4)', [email.id, eventTypeUpper, timestamp, email.emailCampaignId]);
				console.log(`Inserted ${eventTypeUpper} event for email ID ${email.id}`);

				if (eventType === "Bounce" || eventType === "Complaint") {
					// set isSubscribedToEmail to false where lead.email === destination[0]
					await query('UPDATE "Lead" SET "isSubscribedToEmail" = false WHERE "email" = $1', [destination[0]]);
					// console.log(leadUpdate.rows);
					// console.log("Inserting into SuppressedMail...");
					await query('INSERT INTO "BlacklistedEmail" ("id", "emailId", "email") VALUES (uuid_generate_v4(), $1, $2)', [email.id, destination[0]]);
					await query('UPDATE "Email" SET "status" = $1 WHERE "id" = $2 ', ["SUPPRESS", email.id]);
					console.log(`Inserted email ID ${email.id} into SuppressedMail`);
				}
			} catch (error) {
				console.log(error);
				return;
			}
		}

		await deleteMessage(message.ReceiptHandle!);
	}
}
