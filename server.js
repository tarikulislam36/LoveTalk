// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve static (room.html placed in same folder)
app.use(express.static("."));

// In-memory map: roomId -> Set of peerIds
const rooms = new Map();

// helper to get array safely
function getRoomList(roomId) {
    return rooms.has(roomId) ? Array.from(rooms.get(roomId)) : [];
}

io.on("connection", socket => {
    console.log("Socket connected", socket.id);

    // when client joins room (peerId is the PeerJS id)
    socket.on("join-room", (roomId, peerId) => {
        if (!roomId || !peerId) return;
        console.log(`join-room: ${roomId} <- ${peerId} (socket ${socket.id})`);
        socket.join(roomId);

        // keep mapping from socket to peerId & room for easy cleanup
        socket.data.peerId = peerId;
        socket.data.roomId = roomId;

        // add to room set
        if (!rooms.has(roomId)) rooms.set(roomId, new Set());
        rooms.get(roomId).add(peerId);

        // notify others in room
        socket.to(roomId).emit("user-joined", peerId);

        // emit current active users list to all in room
        io.to(roomId).emit("active-users", getRoomList(roomId));
    });

    // client asking for list explicitly
    socket.on("request-active-users", (roomId) => {
        socket.emit("active-users", getRoomList(roomId));
    });

    // typing indicator
    socket.on("typing", (roomId, peerId) => {
        socket.to(roomId).emit("typing", peerId);
    });

    // chat messaging
    socket.on("chat-message", (payload) => {
        // payload: { roomId, text, from }
        if (!payload || !payload.roomId || !payload.text) return;
        const out = { from: payload.from || "unknown", text: payload.text, me: false };
        // broadcast to others in the room
        socket.to(payload.roomId).emit("chat-message", out);
        // optionally echo back to sender through confirm (sender already appends locally)
    });

    // handle disconnect: remove from rooms and notify
    socket.on("disconnecting", () => {
        const roomId = socket.data.roomId;
        const peerId = socket.data.peerId;
        if (roomId && peerId && rooms.has(roomId)) {
            const set = rooms.get(roomId);
            set.delete(peerId);
            if (set.size === 0) rooms.delete(roomId);
            // notify remaining members
            socket.to(roomId).emit("user-left", peerId);
            // update active users list
            io.to(roomId).emit("active-users", getRoomList(roomId));
            console.log(`Peer ${peerId} left room ${roomId}`);
        }
    });

    socket.on("disconnect", () => {
        // nothing extra needed here since handled in disconnecting
        console.log("Socket disconnected", socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
