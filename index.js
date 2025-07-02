//"tokenizers-linux-x64-gnu": "0.13.4-rc1"
//"tokenizers-win32-x64-msvc": "^0.13.4-rc1",

const { loadModel, moderate } = require("./moderation");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { v4: uuid } = require("uuid");

const connectDB = require('./db');
connectDB();
const User = require('./schemas/User');


(async () => {
  await loadModel();

  const sampleText = "kill you";
  const isToxic = await moderate(sampleText);

  console.log(`Toxic: ${isToxic}`); // 🔴 should log: Toxic: true
})();

dotenv.config();
const { GOOGLE_CLIENT_ID, APP_JWT_SECRET } = process.env;
const FRONTEND_ORIGIN = process.env.CLIENT_URL || "http://localhost:3000";
const PORT = process.env.PORT || 5000;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/api/issues", require("./routes/issues"));


// Socket.io authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error"));
  }
  
  try {
    const decoded = jwt.verify(token, APP_JWT_SECRET);
    socket.user = decoded; // Attach user data to the socket
    console.log("Nothing occur");
    next();
  } catch (err) {
    console.log("Error occur");
    next(new Error("Authentication error"));
  }
});

const waitingQueue = []; // FIFO list of idle users
const activeRooms = new Map();   // roomId → { a, b }


function dequeue(socketId) {
  const ix = waitingQueue.findIndex(u => u.socketId === socketId);
  if (ix !== -1) waitingQueue.splice(ix, 1);
}


const prefSet = (pref = "both") => {
  if (pref === "male")   return ["male"];
  if (pref === "female") return ["female"];
  // "both" or anything else → accept any
  return ["male", "female", "other"];
};

const isCompatible = (u, v) =>
  prefSet(u.pref).includes(v.gender) &&
  prefSet(v.pref).includes(u.gender);

function tryPair(io) {
  for (let i = 0; i < waitingQueue.length; i++) {
    for (let j = i + 1; j < waitingQueue.length; j++) {
    const a = waitingQueue[i];
    const b = waitingQueue[j];


    if (!isCompatible(a, b)) continue;

    // --- Found a match ---
    waitingQueue.splice(j, 1);       // remove j first (higher index)
    waitingQueue.splice(i, 1);       // remove i


    const roomId = uuid();
    activeRooms.set(roomId, { a: a.socketId, b: b.socketId });


    // A initiates the call
    io.to(a.socketId).emit("match:paired", {
      roomId,
      peerId: b.socketId,
      peerEmail: b.email,
      peerName: b.name,
      peerAge: b.age,
      peerGender: b.gender,
      initiator: true,
    });

    // B only listens
    io.to(b.socketId).emit("match:paired", {
      roomId,
      peerId: a.socketId,
      peerEmail: a.email,
      peerName: a.name,
      peerAge: a.age,
      peerGender: a.gender,
      initiator: false,
    });

    // Join both to the same room
    io.sockets.sockets.get(a.socketId)?.join(roomId);
    io.sockets.sockets.get(b.socketId)?.join(roomId);
  
    // Queue changed → restart scan
    return tryPair(io);
  }
  }
}

io.on("connection", (socket) => {
  console.log(`Socket Connected`, socket.id, "for user:", socket.user.email);
  socket.emit("stats:usercount", io.engine.clientsCount);
  io.emit("stats:usercount", io.engine.clientsCount);

  socket.on("chat:send", async ({ roomId, text, replyTo }) => {
  // ignore empty / whitespace
  if (!text?.trim()) return;

  const msg = {
      id: uuid(),
      text: text.trim(),
      senderId: socket.id,
      senderName: socket.user.name,
      ts: Date.now(),
      replyTo: replyTo || null,    // Ensure replyTo is never undefined
    };
    io.to(roomId).emit("chat:message", msg);  // broadcast to *all*, incl. sender
  });

  socket.on("file:send", ({ roomId, ...file }) => {
  // Quick guard against big or suspicious payloads
  if (file.size > 300_000 || !/^image\/(png|jpe?g|gif)$/i.test(file.type)) return;
  socket.to(roomId).emit("file:receive", file);  // forward to peer only
  });

  

  // User clicks "Do a call"
  socket.on("queue:join", ({ age, gender, pref }) => {
    dequeue(socket.id);
    waitingQueue.push({ 
      socketId: socket.id, 
      email: socket.user.email,
      name: socket.user.name,
      age, 
      gender,
      pref
    });
    tryPair(io);
  });

  const moderationCache = new Map();
  const reportedMessages = new Set();   // messageId that was reported once

  socket.on("message:report", async ({ roomId, messageId, text, senderId }) => {
    // 1️⃣ Validate reporter is actually in that room
    const rooms = [...socket.rooms];                 // Set → Array
    if (!rooms.includes(roomId)) return;  
    // If someone already reported this message → notify reporter & bail
    if (reportedMessages.has(messageId)) {
      socket.emit("abuse:alreadyReported", { messageId });
      return;
    }
    

    try {
      // 2️⃣ Check cache first
      reportedMessages.add(messageId);
      let abusive;
      if (moderationCache.has(messageId)) {
        abusive = moderationCache.get(messageId).abusive;
        console.log(`Message ${messageId} found in cache. Abusive: ${abusive}`);
      }else {
        // Use your imported 'moderate' function here!
        abusive = await moderate(text);
        moderationCache.set(messageId, { abusive, checked: true });
        console.log(`Message ${messageId} moderated. Abusive: ${abusive}`);
      }
      
      if (abusive) {
        /* 2️⃣ — decrement honor of the offender */
        const offenderSocket = io.sockets.sockets.get(senderId);
        const offenderUid    = offenderSocket?.user?.uid;   // googleId stored in JWT
        // ✔️ Broadcast once; include who was flagged
        let newHonor = null;
        if (offenderUid) {
          const updated = await User.findOneAndUpdate(
            { googleId: offenderUid },
            { $inc: { honor: -1 } },
            { new: true, projection: { honor: 1 } }
          );
          newHonor = updated?.honor ?? null;
        }
        io.to(roomId).emit("abuse:detected", {
          offenderId: senderId,
          offenderName:
            io.sockets.sockets.get(senderId)?.user?.name || "Unknown",
          honor : newHonor,            
          messageId,
        });
        console.log(`Message ${messageId} flagged as abusive`);
      } else {
        // ✉️ Tell the reporter the message is clean
        socket.emit("abuse:cleared", { offenderId: senderId,
          offenderName: io.sockets.sockets.get(senderId)?.user?.name || "Unknown",
          messageId });
      }
    } catch (err) {
      console.error("Moderation failed:", err);
      socket.emit("abuse:error", {
        messageId,
        msg: "Moderation service unavailable",
      });
    }
  });

// ───────── queue:leave (user cancelled waiting or aborted the call) ─────────
socket.on("queue:leave", () => {
  // 1) If they were still waiting, just pull them out of the FIFO
  dequeue(socket.id);

  // 2) If they had already been paired, notify the other side
  for (const [roomId, peers] of activeRooms.entries()) {
    if (peers.a === socket.id || peers.b === socket.id) {
      const other = peers.a === socket.id ? peers.b : peers.a;
      io.to(other).emit("call:ended");
      io.socketsLeave(roomId);        // drop both from the room
      activeRooms.delete(roomId);
      break;
    }
  }
});


  // User ends the current call
  socket.on("call:end", ({ roomId, to }) => {
    io.to(to).emit("call:ended");
    io.socketsLeave(roomId);
  });

  // Clean up on disconnect
  socket.on("disconnect", () => {
    io.emit("stats:usercount", io.engine.clientsCount);
    dequeue(socket.id)
  });

  socket.on("user:call", ({ to, offer }) => {
    io.to(to).emit("incomming:call", { from: socket.id, offer });
  });

  socket.on("call:accepted", ({ to, ans }) => {
    io.to(to).emit("call:accepted", { from: socket.id, ans });
  });

  socket.on("ice:candidate", ({ to, candidate }) => {
    io.to(to).emit("ice:candidate", { from: socket.id, candidate });
  });
});

// Google login endpoint
app.post("/api/google-login", async (req, res) => {
  const { credential } = req.body;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const { sub: googleId, email, name, picture } = ticket.getPayload();

    // Mint JWT (2 hours)
    const appToken = jwt.sign({ uid: googleId, email, name}, APP_JWT_SECRET, {
      expiresIn: "2h",
    });

    let person = await User.findOne({ email });
    if (!person) {
      person = new User({ googleId, email, name, picture, honor:10 });
      await person.save();
    }

    res.json({ token: appToken, user: { email, name, picture } });

  } catch (err) {
    console.error(err);
    res.status(401).json({ error: "Invalid Google token" });
  }
});

// Example protected route
app.get("/api/me", (req, res) => {
  const auth = req.headers.authorization?.split(" ")[1];
  try {
    const payload = jwt.verify(auth, APP_JWT_SECRET);
    res.json({ user: payload });
  } catch {
    res.status(401).json({ error: "Bad or expired token" });
  }
});

// Public endpoint for live user count
app.get("/api/live-users", (req, res) => {
  res.json({ count: io.engine.clientsCount });
});


httpServer.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));




// const { Server } = require("socket.io");

// const io = new Server(8000, {
//   cors: true,
// });

// // TOP OF FILE
// const { v4: uuid } = require("uuid");          // npm i uuid
// const waitingQueue = [];                       // FIFO list of idle users

// function dequeue(socketId) {
//   const ix = waitingQueue.findIndex(u => u.socketId === socketId);
//   if (ix !== -1) waitingQueue.splice(ix, 1);
// }

// function tryPair(io) {
//   while (waitingQueue.length >= 2) {
//     const a = waitingQueue.shift();
//     const b = waitingQueue.shift();
//     const roomId = uuid();                     // unique “private” room

    
//     // A initiates the call
//     io.to(a.socketId).emit("match:paired", {
//       roomId,
//       peerId: b.socketId,
//       peerEmail: b.email,
//       peerName: b.name,
//       peerAge: b.age,
//       peerGender: b.gender,
//       initiator: true,  // ✅ ADD THIS
//     });

//     // B only listens
//     io.to(b.socketId).emit("match:paired", {
//       roomId,
//       peerId: a.socketId,
//       peerEmail: a.email,
//       peerName: a.name,
//       peerAge: a.age,
//       peerGender: a.gender,
//       initiator: false, // ✅ ADD THIS
//     });

//     // Join both to the same room
//     io.sockets.sockets.get(a.socketId)?.join(roomId);
//     io.sockets.sockets.get(b.socketId)?.join(roomId);
//   }
// }


// io.on("connection", (socket) => {
//   console.log(`Socket Connected`, socket.id);

//   // User clicks “Do a call”
//   socket.on("queue:join", ({ email, name, age, gender }) => {
//     dequeue(socket.id);                          // avoid duplicates
//     waitingQueue.push({ socketId: socket.id, email, name, age, gender });
//     tryPair(io);
//   });

// // User ends the current call
//    socket.on("call:end", ({ roomId, to }) => {
//     io.to(to).emit("call:ended");                // tell the stranger
//     io.socketsLeave(roomId);                     // both leave room
//     // stopper can immediately re-queue from client side if desired
//   });

// // Clean up on disconnect
//   socket.on("disconnect", () => dequeue(socket.id));



//   socket.on("user:call", ({ to, offer }) => {
//     io.to(to).emit("incomming:call", { from: socket.id, offer });
//   });

//   socket.on("call:accepted", ({ to, ans }) => {
//     io.to(to).emit("call:accepted", { from: socket.id, ans });
//   });

//   socket.on("ice:candidate", ({ to, candidate }) => {
//     io.to(to).emit("ice:candidate", { from: socket.id, candidate });
//   });
// });
// setInterval(() => {
//   console.log("Current waitingQueue:", waitingQueue.map(u => ({
//     socketId: u.socketId,
//     email: u.email,
//     name: u.name
//   })));
// }, 15000);

