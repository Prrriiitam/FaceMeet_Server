const mongoose = require('mongoose');
require('dotenv').config();

function connectDB() {
  mongoose.connect(process.env.MONGODB_URI, {
    family: 4,
    serverSelectionTimeoutMS: 30000,  // wait 30 s before throwing
    tls: true,                        // explicit TLS
    tlsAllowInvalidCertificates: false,
  });

  mongoose.connection.on('connected', () => {
    console.log('🗄️  MongoDB connected');
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
  });
}

module.exports = connectDB;
