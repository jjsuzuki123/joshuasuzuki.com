const jwt = require('jsonwebtoken');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { password } = body;

    if (!password || password !== ADMIN_PASSWORD) {
      return {
        statusCode: 401,
        headers: corsHeaders(),
        body: JSON.stringify({ message: 'Unauthorized' }),
      };
    }

    const token = jwt.sign(
      { role: 'admin' },
      JWT_SECRET,
      { expiresIn: TOKEN_TTL_SECONDS }
    );

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ token }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Server error' }),
    };
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://joshuasuzuki.com',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
  };
}
