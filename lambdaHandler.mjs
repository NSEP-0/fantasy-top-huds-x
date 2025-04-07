import dotenv from 'dotenv';
dotenv.config();
import { processMentions } from './mentionProcessor.mjs';

// Initialize Lambda environment variables
process.env.USE_DYNAMO_STATE = 'true'; // Force DynamoDB in Lambda
process.env.FALLBACK_TO_FILE = 'true'; // Always enable file fallback
process.env.STATE_FILE_PATH = '/tmp/state.json'; // Use Lambda's temp directory for fallback

// Set AWS region if not already set
if (!process.env.AWS_REGION) {
  process.env.AWS_REGION = 'us-east-1';
}

/**
 * AWS Lambda handler function
 */
export const handler = async (event, context) => {
  console.log('Lambda invoked:', new Date().toISOString());
  console.log('Remaining time (ms):', context.getRemainingTimeInMillis());
  console.log('Event:', JSON.stringify(event));
  
  try {
    console.log('Starting to process mentions...');
    const result = await processMentions();
    console.log('Mentions processed successfully:', result);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Mentions processed successfully',
        stats: result
      })
    };
  } catch (error) {
    console.error('Processing failed:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error processing mentions',
        error: error.message
      })
    };
  }
};
