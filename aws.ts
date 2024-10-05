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

		if (["Bounce", "Click", "Open", "Reject", "Complaint", "Delivery"].includes(eventType)) {
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

				if (eventTypeUpper === "BOUNCE") {
					const existingBounce = await query('SELECT 1 FROM "EmailEvent" WHERE "emailId" = $1 AND "eventType" = $2', [email.id, "BOUNCE"]);
					if (existingBounce.rowCount && existingBounce.rowCount > 0) {
						console.log(`BOUNCE event already exists for email ID ${email.id}, skipping...`);
						return;
					}
				}

				if (eventTypeUpper === "OPEN") {
					const existingOpen = await query('SELECT 1 FROM "EmailEvent" WHERE "emailId" = $1 AND "eventType" = $2', [email.id, "OPEN"]);
					if (existingOpen.rowCount && existingOpen.rowCount > 0) {
						console.log(`OPEN event already exists for email ID ${email.id}, skipping...`);
						return;
					}
				}

				const existingEvent = await query('SELECT * FROM "EmailEvent" WHERE "emailId" = $1 AND "eventType" = $2', [email.id, "DELIVERY"]);

				if (existingEvent.rowCount && existingEvent.rowCount > 0 && eventTypeUpper === "BOUNCE") {
					await query('UPDATE "EmailEvent" SET "eventType" = $1, "timestamp" = $2 WHERE "emailId" = $3 AND "eventType" = $4', [eventTypeUpper, timestamp, email.id, "DELIVERY"]);
					console.log(`Updated event type from DELIVERY to BOUNCE for email ID ${email.id}`);
				} else {
					// console.log("Inserting into EmailEvent...");
					await query('INSERT INTO "EmailEvent" ("id", "emailId", "eventType", "timestamp", "campaignId") VALUES (uuid_generate_v4(), $1, $2, $3, $4)', [email.id, eventTypeUpper, timestamp, email.emailCampaignId]);
					console.log(`Inserted ${eventTypeUpper} event for email ID ${email.id}`);
				}

				if (eventType === "Bounce" || eventType === "Complaint") {
					// set isSubscribedToEmail to false where lead.email === destination[0]
					await query('UPDATE "Lead" SET "isSubscribedToEmail" = false WHERE "email" = $1', [destination[0]]);
					// console.log(leadUpdate.rows);
					// console.log("Inserting into SuppressedMail...");					

					const existingBlacklistEntry = await query('SELECT 1 FROM "BlacklistedEmail" WHERE "email" = $1', [destination[0]]);

					if (existingBlacklistEntry.rowCount === 0) {
						await query('INSERT INTO "BlacklistedEmail" ("id", "email") VALUES (uuid_generate_v4(), $1)', [destination[0]]);
						console.log(`Inserted email ${destination[0]} into BlacklistedEmail`);
					} else {
						console.log(`Email ${destination[0]} is already in BlacklistedEmail`);
					}

					await query('UPDATE "Email" SET "status" = $1 WHERE "id" = $2', ["SUPPRESS", email.id]);
					console.log(`Updated email ID ${email.id} status to SUPPRESS`);
				}
			} catch (error) {
				console.log(error);
				return;
			}
		}

		await deleteMessage(message.ReceiptHandle!);
	}
}
