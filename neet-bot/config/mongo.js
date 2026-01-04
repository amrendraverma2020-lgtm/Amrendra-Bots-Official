const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.MONGODB_URI);

async function connectDB() {
  if (!client.topology?.isConnected()) {
    await client.connect();
    console.log("✅ MongoDB connected");
  }
  return client.db();
}

module.exports = connectDB;
