const jwt = require('jsonwebtoken');
const {
  DynamoDBClient,
  ScanCommand,
  DeleteItemCommand,
} = require('@aws-sdk/client-dynamodb');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const TABLE_NAME = process.env.MESSAGES_TABLE;

// Explicit region (adjust if your table is elsewhere)
const db = new DynamoDBClient({ region: 'us-east-1' });

exports.handler = async (event) => {
  console.log('admin-messages event:', JSON.stringify(event));

  try {
    if (!JWT_SECRET) {
      console.error('JWT_SECRET not set');
      return errorResponse(500, 'Server misconfigured: JWT_SECRET not set');
    }
    if (!TABLE_NAME) {
      console.error('MESSAGES_TABLE not set');
      return errorResponse(500, 'Server misconfigured: MESSAGES_TABLE not set');
    }

    const method =
      event.requestContext?.http?.method || event.httpMethod || 'GET';

    // Auth
    const authHeader =
      event.headers?.Authorization || event.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      console.log('Missing bearer token');
      return errorResponse(401, 'Unauthorized: no token provided');
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      console.log('JWT payload:', payload);
      if (payload.role !== 'admin') {
        console.log('Invalid role in token');
        return errorResponse(401, 'Unauthorized: invalid role');
      }
    } catch (err) {
      console.error('JWT verify error', err);
      return errorResponse(401, `Unauthorized: ${err.message}`);
    }

    // Route by method
    if (method === 'GET') {
      return await handleList();
    } else if (method === 'DELETE') {
      return await handleDelete(event);
    }

    return errorResponse(405, `Method ${method} not allowed`);
  } catch (err) {
    console.error('Unexpected error in admin-messages:', err);
    return errorResponse(500, `Unexpected error: ${err.message}`);
  }
};

async function handleList() {
  try {
    console.log('Scanning DynamoDB table:', TABLE_NAME);
    const result = await db.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        Limit: 100,
      })
    );

    console.log('DynamoDB scan result raw:', JSON.stringify(result));

    const items = (result.Items || []).map((item) => ({
      id: item.id?.S,
      name: item.name?.S,
      email: item.email?.S,
      message: item.message?.S,
      createdAt: item.createdAt?.S,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ items }),
    };
  } catch (dbErr) {
    console.error('DynamoDB list error:', dbErr);
    return errorResponse(500, `DynamoDB error: ${dbErr.name} - ${dbErr.message}`);
  }
}

async function handleDelete(event) {
  const id =
    event.pathParameters?.id ||
    event.pathParameters?.messageId ||
    null;

  if (!id) {
    return errorResponse(400, 'Missing id path parameter');
  }

  console.log('Deleting item with id:', id);

  try {
    await db.send(
      new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: {
          id: { S: id },
        },
      })
    );

    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: '',
    };
  } catch (dbErr) {
    console.error('DynamoDB delete error:', dbErr);
    return errorResponse(500, `DynamoDB error: ${dbErr.name} - ${dbErr.message}`);
  }
}

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ message }),
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://joshuasuzuki.com',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,DELETE',
  };
}
