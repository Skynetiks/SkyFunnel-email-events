import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import "dotenv/config";
import { Mail } from "./types";
import { query } from "./db";

const REGION = process.env.S3_REGION;
const QUEUE_URL = process.env.SQS_QUEUE_URL;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const VISIBILITY_TIMEOUT = 50; // in secs

if (!REGION || !QUEUE_URL || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
  throw new Error("Missing required environment variables");
}

const sqsClient = new SQSClient({
  region: REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

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
    console.error("Error receiving messages from SQS:", error);
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
    console.error("Error deleting message from SQS:", error);
  }
}

async function addEmailToBlacklist(email: string) {
  try {
    // Check if email is already in blacklist
    const existingEntry = await query(
      'SELECT 1 FROM "BlacklistedEmail" WHERE "email" = $1',
      [email]
    );

    if (existingEntry.rowCount === 0) {
      // Insert into BlacklistedEmail if not present
      await query(
        'INSERT INTO "BlacklistedEmail" ("id", "email") VALUES (uuid_generate_v4(), $1)',
        [email]
      );
      console.log(`Inserted email ${email} into BlacklistedEmail`);
    } else {
      console.log(`Email ${email} is already in BlacklistedEmail`);
    }
  } catch (error) {
    console.error(`Error adding email ${email} to BlacklistedEmail:`, error);
    throw error;
  }
}

async function logEmailEvent(
  emailId: string,
  eventType: string,
  timestamp: string,
  campaignId: string
) {
  try {
    // Check if the event already exists for the email and event type
    const existingEvent = await query(
      'SELECT 1 FROM "EmailEvent" WHERE "emailId" = $1 AND "eventType" = $2',
      [emailId, eventType]
    );

    if (existingEvent.rowCount && existingEvent.rowCount > 0) {
      console.log(
        `${eventType} event already exists for email ID ${emailId}, skipping insertion...`
      );
      return;
    }

    // Insert a new event if it doesn't already exist
    await query(
      'INSERT INTO "EmailEvent" ("id", "emailId", "eventType", "timestamp", "campaignId") VALUES (uuid_generate_v4(), $1, $2, $3, $4)',
      [emailId, eventType, timestamp, campaignId]
    );
    console.log(`Inserted ${eventType} event for email ID ${emailId}`);
  } catch (error) {
    console.error(
      `Error logging ${eventType} event for email ID ${emailId}:`,
      error
    );
    throw error;
  }
}

async function addToValidatedEmails(
  email: string,
  timestamp: string,
  status: string
) {
  try {
    // Check if email is already in ValidatedEmails
    const existingEntry = await query(
      'SELECT 1 FROM "ValidatedEmail" WHERE "email" = $1',
      [email]
    );

    if (existingEntry.rowCount === 0) {
      // Insert into ValidatedEmails if not present
      await query(
        'INSERT INTO "ValidatedEmail" ("id", "taskId", "email", "emailStatus") VALUES (uuid_generate_v4(), $1, $2, $3)',
        ["00", email, status]
      );
      console.log(
        `Inserted email ${email} into ValidatedEmail with status ${status}`
      );
    } else {
      await query(
        'UPDATE "ValidatedEmail" SET "emailStatus" = $1, "createdAt" = $2 WHERE "email" = $3',
        [status, timestamp, email]
      );
      console.log(
        `Updated email ${email} in ValidatedEmails with status ${status}`
      );
    }
  } catch (error) {
    console.error(`Error adding email ${email} to ValidatedEmails:`, error);
    throw error;
  }
}

export async function processMessage(message: any) {
  if (!message.Body) return;

  const body = JSON.parse(message.Body);
  const eventType = body.eventType;

  // Check if the eventType is one we want to process
  if (!["Bounce", "Complaint"].includes(eventType)) {
    console.log(`Unsupported event type: ${eventType}`);
    await deleteMessage(message.ReceiptHandle!);
    return;
  }

  const mail = body.mail as Mail;
  const { messageId, timestamp, destination } = mail;
  const eventTypeUpper = eventType.toUpperCase();

  try {
    // Retrieve the email based on messageId
    const result = await query(
      'SELECT * FROM "Email" WHERE "messageId" = $1',
      [messageId]
    );
    const email = result.rows[0];

    if (!email) {
      console.log(
        `Email with message ID ${messageId} does not exist in the Email table.`
      );
      await deleteMessage(message.ReceiptHandle!);
      return;
    }

    if (eventTypeUpper === "BOUNCE") {
      await addEmailToBlacklist(destination[0]);

      // Add to validated emails
      addToValidatedEmails(destination[0], timestamp, "INVALID");

      // Set all leads with email as invalid
      await query('UPDATE "Lead" SET "isEmailValid" = $1 WHERE "email" = $2', [
        "INVALID",
        destination[0],
      ]);
      console.log(
        `Updated all leads validation status for email ${destination[0]}`
      );
    }

    // Log the event, with existing event checks handled in logEmailEvent
    await logEmailEvent(
      email.id,
      eventTypeUpper,
      timestamp,
      email.emailCampaignId
    );

    // Unsubscribe lead if "Complaint"
    if (eventType === "Complaint") {
      await query(
        'UPDATE "Lead" SET "isSubscribedToEmail" = false WHERE "email" = $1',
        [destination[0]]
      );
      console.log(`Updated subscription status for email ${destination[0]}`);

      await query('UPDATE "Email" SET "status" = $1 WHERE "id" = $2', [
        "SUPPRESS",
        email.id,
      ]);
      console.log(`Updated email ID ${email.id} status to SUPPRESS`);
    }
  } catch (error) {
    console.error(`Error processing message for email ID ${messageId}:`, error);
  } finally {
    // Delete the message from the queue
    await deleteMessage(message.ReceiptHandle!);
  }
}
