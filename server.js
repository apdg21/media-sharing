const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

const mediaRooms = new Map();
const roomMediaState = new Map();
const roomPrivacy = new Map(); // Track room privacy

// Generate easy-to-share room codes
function generateRoomCode() {
  const adjectives = ['Quick', 'Smart', 'Clear', 'Bright', 'Calm', 'Fast', 'Easy', 'Safe', 'Team', 'Work'];
  const nouns = ['Team', 'Focus', 'Stream', 'Share', 'Sync', 'Meet', 'View', 'Cast', 'Room', 'Space'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const numbers = Math.floor(100 + Math.random() * 900);
  return `${adj}${noun}${numbers}`;
}

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  socket.on('join-media-room', (roomName, displayName) => {
    try {
      console.log(`🎬 ${socket.id} joining media room ${roomName} as ${displayName}`);
      
      // Leave any other media rooms
      for (const r of socket.rooms) {
        if (r.startsWith('media-')) socket.leave(r);
      }
      
      const mediaRoomId = `media-${roomName}`;
      socket.join(mediaRoomId);
      
      if (!mediaRooms.has(mediaRoomId)) {
        mediaRooms.set(mediaRoomId, new Map());
        // Mark as public if it's the default lobby
        roomPrivacy.set(mediaRoomId, {
          isPublic: roomName === 'public-lobby',
          createdBy: socket.id,
          createdAt: Date.now()
        });
        console.log(`🎯 Created new media room: ${roomName}`);
      }
      
      const mediaRoom = mediaRooms.get(mediaRoomId);
      const isFirstUser = mediaRoom.size === 0;
      
      mediaRoom.set(socket.id, {
        id: socket.id,
        displayName: displayName || `User${socket.id.substring(0, 6)}`,
        isHost: isFirstUser
      });
      
      console.log(`📊 Media room ${roomName} has ${mediaRoom.size} users`);
      
      const users = Array.from(mediaRoom.values());
      const hostId = isFirstUser ? socket.id : Array.from(mediaRoom.values()).find(user => user.isHost)?.id;
      
      // Get current media state for this room
      const currentMediaState = roomMediaState.get(mediaRoomId) || null;
      const privacyInfo = roomPrivacy.get(mediaRoomId) || { isPublic: true };
      
      // Send current users AND media state to the joining user
      socket.emit('media-room-joined', users, hostId, currentMediaState, privacyInfo);
      
      // Notify other users in the media room
      socket.to(mediaRoomId).emit('media-user-connected', {
        id: socket.id,
        displayName: displayName || `User${socket.id.substring(0, 6)}`,
        isHost: isFirstUser
      });

      // If there's media playing, send sync request to host for latest position
      if (currentMediaState && !isFirstUser) {
        const host = Array.from(mediaRoom.values()).find(user => user.isHost);
        if (host) {
          socket.to(host.id).emit('media-sync-request', {
            from: socket.id,
            room: roomName,
            reason: 'new-joiner'
          });
          console.log(`🔄 New joiner ${socket.id} requested sync from host ${host.id}`);
        }
      }
      
    } catch (err) {
      console.error('❌ Error join-media-room:', err);
      socket.emit('error', { message: 'Failed to join media room' });
    }
  });

  socket.on('create-private-room', (displayName) => {
    try {
      const roomCode = generateRoomCode();
      const mediaRoomId = `media-${roomCode}`;
      
      // Leave any current rooms
      for (const r of socket.rooms) {
        if (r.startsWith('media-')) socket.leave(r);
      }
      
      // Create new private room
      mediaRooms.set(mediaRoomId, new Map());
      roomPrivacy.set(mediaRoomId, {
        isPublic: false,
        createdBy: socket.id,
        createdAt: Date.now()
      });
      
      socket.join(mediaRoomId);
      
      const mediaRoom = mediaRooms.get(mediaRoomId);
      mediaRoom.set(socket.id, {
        id: socket.id,
        displayName: displayName || `User${socket.id.substring(0, 6)}`,
        isHost: true
      });
      
      console.log(`🔒 Private room created: ${roomCode} by ${socket.id}`);
      
      // Send success with room code
      socket.emit('private-room-created', roomCode, [{
        id: socket.id,
        displayName: displayName || `User${socket.id.substring(0, 6)}`,
        isHost: true
      }]);
      
    } catch (err) {
      console.error('❌ Error creating private room:', err);
      socket.emit('error', { message: 'Failed to create private room' });
    }
  });

  socket.on('leave-media-room', (roomName) => {
    handleMediaUserLeave(roomName, socket.id);
  });

  socket.on('request-host', (roomName) => {
    const mediaRoomId = `media-${roomName}`;
    if (!mediaRooms.has(mediaRoomId)) return;
    
    const mediaRoom = mediaRooms.get(mediaRoomId);
    
    // Check if there's already a host
    const currentHost = Array.from(mediaRoom.values()).find(user => user.isHost);
    
    if (!currentHost) {
      // No host exists, assign this user as host
      const user = mediaRoom.get(socket.id);
      if (user) {
        user.isHost = true;
        
        // Notify all users in the media room
        io.to(mediaRoomId).emit('media-host-changed', socket.id);
        console.log(`👑 ${socket.id} became host in media room ${roomName}`);
      }
    } else {
      console.log(`❌ ${socket.id} requested host but ${currentHost.id} is already host`);
    }
  });

  socket.on('media-control', (data) => {
    const mediaRoomId = `media-${data.room}`;
    if (!mediaRooms.has(mediaRoomId)) {
      console.warn(`Media control for non-existent room: ${data.room}`);
      return;
    }
    
    const mediaRoom = mediaRooms.get(mediaRoomId);
    const user = mediaRoom.get(socket.id);
    
    // Only allow hosts to control media
    if (user && user.isHost) {
      console.log(`🎮 Media control from host ${socket.id} in room ${data.room}:`, data.type);
      
      // Update room media state for load commands
      if (data.type.startsWith('load-')) {
        roomMediaState.set(mediaRoomId, {
          type: data.type,
          mediaType: data.mediaType,
          videoId: data.videoId,
          url: data.url,
          platform: data.platform,
          fileName: data.fileName,
          startTime: data.startTime || 0,
          timestamp: Date.now(),
          hostId: socket.id
        });
        console.log(`💾 Updated media state for room ${data.room}:`, data.type);
      }
      
      // Add timestamp for sync
      data.timestamp = Date.now();
      data.from = socket.id;
      
      // Broadcast media control to all other users in the media room
      socket.to(mediaRoomId).emit('media-control', data);
    } else {
      console.warn(`❌ Non-host ${socket.id} attempted media control in room ${data.room}`);
      
      // Send error back to the user
      socket.emit('media-error', { 
        message: 'Only the host can control media playback' 
      });
    }
  });

  socket.on('media-sync', (data) => {
    const mediaRoomId = `media-${data.room}`;
    if (!mediaRooms.has(mediaRoomId)) return;
    
    const mediaRoom = mediaRooms.get(mediaRoomId);
    const user = mediaRoom.get(socket.id);
    
    // Only allow hosts to send sync data
    if (user && user.isHost) {
      console.log(`🔄 Media sync from host ${socket.id} in room ${data.room}`);
      
      // Update sync state
      const currentState = roomMediaState.get(mediaRoomId);
      if (currentState) {
        currentState.lastSyncTime = data.time;
        currentState.lastSyncTimestamp = data.timestamp;
        roomMediaState.set(mediaRoomId, currentState);
      }
      
      // Broadcast sync data to all other users
      socket.to(mediaRoomId).emit('media-sync', {
        ...data,
        from: socket.id
      });
    }
  });

  socket.on('request-sync', (roomName) => {
    const mediaRoomId = `media-${roomName}`;
    if (!mediaRooms.has(mediaRoomId)) return;
    
    const mediaRoom = mediaRooms.get(mediaRoomId);
    
    // Notify the host that a user wants to sync
    const host = Array.from(mediaRoom.values()).find(user => user.isHost);
    if (host && host.id !== socket.id) {
      // Send sync request to host only
      socket.to(host.id).emit('media-sync-request', {
        from: socket.id,
        room: roomName,
        reason: 'manual-sync'
      });
      console.log(`🔄 ${socket.id} requested sync from host ${host.id}`);
    }
  });

  socket.on('get-room-state', (roomName) => {
    const mediaRoomId = `media-${roomName}`;
    const mediaState = roomMediaState.get(mediaRoomId);
    
    socket.emit('room-state', {
      room: roomName,
      mediaState: mediaState
    });
    
    console.log(`📋 Sent room state to ${socket.id} for room ${roomName}`);
  });

  socket.on('media-chat-message', (data) => {
    const mediaRoomId = `media-${data.room}`;
    if (!mediaRooms.has(mediaRoomId)) {
      console.warn(`Media chat for non-existent room: ${data.room}`);
      return;
    }
    
    console.log(`💬 Media chat from ${socket.id} in room ${data.room}`);
    
    // Broadcast media chat message to all other users in the media room
    socket.to(mediaRoomId).emit('media-chat-message', {
      message: data.message,
      sender: data.sender || `User${socket.id.substring(0, 6)}`,
      timestamp: Date.now()
    });
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    
    // Handle media room cleanup
    mediaRooms.forEach((users, mediaRoomId) => {
      if (users.has(socket.id)) {
        const roomName = mediaRoomId.replace('media-', '');
        handleMediaUserLeave(roomName, socket.id);
      }
    });
  });

  function handleMediaUserLeave(roomName, userId) {
    const mediaRoomId = `media-${roomName}`;
    if (!mediaRooms.has(mediaRoomId)) return;
    
    const mediaRoom = mediaRooms.get(mediaRoomId);
    if (mediaRoom.has(userId)) {
      const user = mediaRoom.get(userId);
      const wasHost = user.isHost;
      
      mediaRoom.delete(userId);
      console.log(`⬅️ ${userId} (${user.displayName}) left media room ${roomName}`);
      
      // Notify other users
      socket.to(mediaRoomId).emit('media-user-disconnected', userId);
      
      // If host left and there are other users, assign new host
      if (wasHost && mediaRoom.size > 0) {
        const newHost = Array.from(mediaRoom.values())[0];
        newHost.isHost = true;
        
        io.to(mediaRoomId).emit('media-host-changed', newHost.id);
        console.log(`👑 ${newHost.id} (${newHost.displayName}) became new host in media room ${roomName}`);
        
        // Update media state with new host
        const currentState = roomMediaState.get(mediaRoomId);
        if (currentState) {
          currentState.hostId = newHost.id;
          roomMediaState.set(mediaRoomId, currentState);
        }
      }
      
      if (mediaRoom.size === 0) {
        mediaRooms.delete(mediaRoomId);
        roomMediaState.delete(mediaRoomId);
        roomPrivacy.delete(mediaRoomId);
        console.log(`🗑️ Media room ${roomName} deleted (empty)`);
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Media Sharing Server running on port ${PORT}`);
  console.log(`📱 Access the application at http://localhost:${PORT}`);
});
