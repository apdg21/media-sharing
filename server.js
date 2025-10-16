// Add this function to handle room state
function handleRoomState(mediaState) {
  if (!mediaState) {
    console.log('No media state available in room');
    return;
  }
  
  console.log('Loading room media state:', mediaState);
  
  // Load the appropriate media based on state
  switch (mediaState.type) {
    case 'load-youtube':
      if (mediaState.videoId) {
        loadYouTubeVideo(mediaState.videoId, mediaState.startTime || 0);
        addMediaChatMessage('System', `Synced to host's YouTube video`, 'incoming');
      }
      break;
      
    case 'load-direct-url':
      if (mediaState.url) {
        loadDirectUrlVideo(mediaState.url, mediaState.startTime || 0);
        addMediaChatMessage('System', `Synced to host's video URL`, 'incoming');
      }
      break;
      
    case 'load-embed':
      if (mediaState.platform && mediaState.videoId) {
        loadEmbedVideo(mediaState.platform, mediaState.videoId, mediaState.startTime || 0);
        addMediaChatMessage('System', `Synced to host's embedded video`, 'incoming');
      }
      break;
      
    case 'load-local-file':
      if (mediaState.fileName) {
        addMediaChatMessage('System', `Host is playing: ${mediaState.fileName}. Please load the same file to sync.`, 'incoming');
      }
      break;
  }
}

// Update the media-room-joined event handler
socket.on('media-room-joined', (users, hostId, mediaState) => {
  console.log('Media room joined, users:', users, 'Media state:', mediaState);
  
  users.forEach(user => {
    mediaRoomUsers.set(user.id, user);
  });
  
  isMediaHost = hostId === socket.id;
  updateMediaRoomStatus('connected');
  updateConnectionStatus('connected');
  updateMediaParticipants();
  
  // Enable media controls
  [loadYoutubeBtn, loadDirectUrlBtn, loadEmbedBtn, playLocalBtn, mediaChatInput, sendMediaChatBtn].forEach(btn => {
    btn.disabled = false;
  });
  
  // Handle existing media state if this is a new joiner
  if (mediaState && !isMediaHost) {
    setTimeout(() => {
      handleRoomState(mediaState);
    }, 1000);
  }
  
  if (isMediaHost) {
    becomeHostBtn.disabled = true;
    addMediaChatMessage('System', 'You are the media host. You can control playback for everyone.', 'incoming');
  } else {
    becomeHostBtn.disabled = false;
    addMediaChatMessage('System', `Connected to media room. ${mediaRoomUsers.get(hostId)?.displayName || 'Someone'} is the host.`, 'incoming');
  }
});

// Add this new event handler for manual state requests
socket.on('room-state', (data) => {
  if (data.room === currentMediaRoom) {
    handleRoomState(data.mediaState);
  }
});

// Update the sync button to also request room state
syncMediaBtn.addEventListener('click', () => {
  if (currentMediaRoom) {
    socket.emit('get-room-state', currentMediaRoom);
    addMediaChatMessage('System', 'Requesting current media state from room...', 'incoming');
  }
});

// Update media control functions to include mediaType
function playMedia() {
  switch (currentMediaType) {
    case 'youtube':
      if (youtubePlayerObj) {
        youtubePlayerObj.playVideo();
        if (isMediaHost && currentMediaRoom) {
          socket.emit('media-control', {
            room: currentMediaRoom,
            type: 'play',
            mediaType: 'youtube'
          });
        }
      }
      break;
    case 'direct-url':
      if (directUrlMediaPlayer) {
        directUrlMediaPlayer.play();
        if (isMediaHost && currentMediaRoom) {
          socket.emit('media-control', {
            room: currentMediaRoom,
            type: 'play',
            mediaType: 'direct-url'
          });
        }
      }
      break;
    case 'local-file':
      if (localMediaPlayer) {
        localMediaPlayer.play();
        if (isMediaHost && currentMediaRoom) {
          socket.emit('media-control', {
            room: currentMediaRoom,
            type: 'play',
            mediaType: 'local-file'
          });
        }
      }
      break;
  }
}

// Similarly update pauseMedia, stopMedia functions to include mediaType
