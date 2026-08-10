(function(){
  "use strict";

  // ----- DOM refs -----
  const audio = document.getElementById('audio');
  const fileInput = document.getElementById('fileInput');
  const playlistEl = document.getElementById('playlist');
  const emptyState = document.getElementById('emptyState');
  const dropzone = document.getElementById('dropzone');

  const btnPlay = document.getElementById('btnPlay');
  const iconPlay = document.getElementById('iconPlay');
  const iconPause = document.getElementById('iconPause');
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnShuffle = document.getElementById('btnShuffle');
  const btnRepeat = document.getElementById('btnRepeat');

  const seek = document.getElementById('seek');
  const volume = document.getElementById('volume');
  const timeCurrent = document.getElementById('timeCurrent');
  const timeTotal = document.getElementById('timeTotal');

  const npTitle = document.getElementById('npTitle');
  const npArtist = document.getElementById('npArtist');
  const cassetteTitle = document.getElementById('cassetteTitle');
  const cassetteEl = document.querySelector('.cassette');
  const reelLeft = document.getElementById('reelLeft');
  const reelRight = document.getElementById('reelRight');
  const visCanvas = document.getElementById('visualizer');
  const visCtx = visCanvas.getContext('2d');

  // ----- state -----
  let tracks = [];           // { name, artist, url, liked? }
  let currentIndex = -1;
  let isShuffle = false;
  let isRepeat = false;
  let isSeeking = false;
  let audioCtx, analyser, sourceNode, freqData;

  // ----- generate demo tracks (5 original) -----
  const trackRecipes = [
    { name: 'Neon Drift',      artist: 'Generated · Synthwave',  bpm: 96,  scale: [0,3,5,7,10,12,15],   waveform: 'sawtooth', duration: 18 },
    { name: 'Paper Lanterns',  artist: 'Generated · Lo-fi',       bpm: 78,  scale: [0,2,3,7,9,12],       waveform: 'triangle', duration: 20 },
    { name: 'Glass Corridor',  artist: 'Generated · Ambient',     bpm: 60,  scale: [0,2,4,7,9,11,12],    waveform: 'sine',     duration: 22 },
    { name: 'Copper Wire',     artist: 'Generated · Electro',     bpm: 118, scale: [0,3,5,6,7,10,12],    waveform: 'square',   duration: 16 },
    { name: 'Slow Static',     artist: 'Generated · Chillhop',    bpm: 84,  scale: [0,3,5,7,10,12,14],   waveform: 'triangle', duration: 20 },
  ];

  async function generateTrack(recipe){
    const sampleRate = 44100;
    const totalSamples = Math.ceil(recipe.duration * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);
    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(offlineCtx.destination);
    const secPerBeat = 60 / recipe.bpm;
    const secPerStep = secPerBeat / 2;
    const totalSteps = Math.floor(recipe.duration / secPerStep);
    const baseFreq = 220;
    let rngState = recipe.bpm * 7 + recipe.scale.length;
    function rand(){ rngState = (rngState * 9301 + 49297) % 233280; return rngState / 233280; }
    for(let step = 0; step < totalSteps; step++){
      const t = step * secPerStep;
      if(rand() < 0.7){
        const degree = recipe.scale[Math.floor(rand() * recipe.scale.length)];
        const octaveShift = rand() < 0.15 ? 12 : 0;
        const freq = baseFreq * Math.pow(2, (degree + octaveShift) / 12);
        const osc = offlineCtx.createOscillator();
        osc.type = recipe.waveform;
        osc.frequency.value = freq;
        const noteGain = offlineCtx.createGain();
        const noteDur = secPerStep * (rand() < 0.3 ? 1.6 : 0.8);
        noteGain.gain.setValueAtTime(0, t);
        noteGain.gain.linearRampToValueAtTime(0.5, t + 0.02);
        noteGain.gain.exponentialRampToValueAtTime(0.001, t + noteDur);
        const filter = offlineCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1800;
        const panner = offlineCtx.createStereoPanner();
        panner.pan.value = (rand() - 0.5) * 0.6;
        osc.connect(noteGain).connect(filter).connect(panner).connect(masterGain);
        osc.start(t);
        osc.stop(t + noteDur + 0.05);
      }
      if(step % 4 === 0){
        const kick = offlineCtx.createOscillator();
        kick.type = 'sine';
        const kickGain = offlineCtx.createGain();
        kick.frequency.setValueAtTime(110, t);
        kick.frequency.exponentialRampToValueAtTime(38, t + 0.12);
        kickGain.gain.setValueAtTime(0.35, t);
        kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        kick.connect(kickGain).connect(masterGain);
        kick.start(t);
        kick.stop(t + 0.2);
      }
    }
    const renderedBuffer = await offlineCtx.startRendering();
    return audioBufferToWaveBlob(renderedBuffer);
  }

  function audioBufferToWaveBlob(buffer){
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numFrames = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numFrames * blockAlign;
    const bufferArray = new ArrayBuffer(44 + dataSize);
    const view = new DataView(bufferArray);
    function writeString(offset, str){ for(let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    const channelData = [];
    for(let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch));
    let offset = 44;
    for(let i = 0; i < numFrames; i++){
      for(let ch = 0; ch < numChannels; ch++){
        const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([bufferArray], { type: 'audio/wav' });
  }

  async function loadDemoTracks(){
    npTitle.textContent = '🎧 generating demo…';
    for(const recipe of trackRecipes){
      try {
        const blob = await generateTrack(recipe);
        tracks.push({ name: recipe.name, artist: recipe.artist, url: URL.createObjectURL(blob), liked: false });
      } catch(e){ console.warn('demo gen fail', recipe.name, e); }
    }
    renderPlaylist();
    if(tracks.length) loadTrack(0);
    else resetPlayer();
  }

  // ----- file loading -----
  function addFiles(fileList){
    const files = Array.from(fileList).filter(f => f.type.startsWith('audio/'));
    files.forEach(file => {
      tracks.push({ name: cleanName(file.name), artist: 'Your library', url: URL.createObjectURL(file), liked: false });
    });
    renderPlaylist();
    if(currentIndex === -1 && tracks.length) loadTrack(0);
  }

  function cleanName(filename){ return filename.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '); }

  fileInput.addEventListener('change', (e) => addFiles(e.target.files));

  ['dragenter','dragover'].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); })
  );
  ['dragleave','drop'].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); })
  );
  dropzone.addEventListener('drop', (e) => { if(e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  // ----- render playlist (with like & download) -----
  function renderPlaylist(){
    emptyState.style.display = tracks.length ? 'none' : 'block';
    playlistEl.querySelectorAll('.track-item').forEach(el => el.remove());

    tracks.forEach((track, i) => {
      const li = document.createElement('li');
      li.className = 'track-item' + (i === currentIndex ? ' playing' : '');
      li.innerHTML = `
        <span class="track-num">${String(i+1).padStart(2,'0')}</span>
        <span class="track-name">${track.name}</span>
        <span class="track-actions">
          <button class="like-btn ${track.liked ? 'liked' : ''}" data-index="${i}" aria-label="like">${track.liked ? '♥' : '♡'}</button>
          <button class="download-btn" data-index="${i}" aria-label="download">⬇</button>
          <button class="remove-btn" data-index="${i}" aria-label="remove">✕</button>
        </span>
      `;
      // click to play
      li.querySelector('.track-name').addEventListener('click', () => loadTrack(i, true));
      li.querySelector('.track-num').addEventListener('click', () => loadTrack(i, true));

      // like
      li.querySelector('.like-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        track.liked = !track.liked;
        renderPlaylist();
        if(track.liked) console.log(`❤️ liked ${track.name}`);
      });

      // download
      li.querySelector('.download-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const a = document.createElement('a');
        a.href = track.url;
        a.download = track.name + '.wav';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });

      // remove
      li.querySelector('.remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        removeTrack(i);
      });

      playlistEl.appendChild(li);
    });
  }

  function removeTrack(index){
    const wasCurrent = index === currentIndex;
    tracks.splice(index, 1);
    if(wasCurrent){
      audio.pause();
      setPlayingIcon(false);
      currentIndex = -1;
      if(tracks.length) loadTrack(Math.min(index, tracks.length - 1));
      else resetPlayer();
    } else if(index < currentIndex) currentIndex--;
    renderPlaylist();
  }

  function resetPlayer(){
    audio.src = '';
    npTitle.textContent = '✨ drop your music';
    npArtist.textContent = '— ready —';
    cassetteTitle.textContent = 'No track';
    seek.value = 0;
    timeCurrent.textContent = '0:00';
    timeTotal.textContent = '0:00';
  }

  // ----- playback -----
  function loadTrack(index, autoplay = false){
    if(index < 0 || index >= tracks.length) return;
    currentIndex = index;
    const track = tracks[index];
    audio.src = track.url;
    npTitle.textContent = track.name;
    npArtist.textContent = track.artist || `Track ${index+1} of ${tracks.length}`;
    cassetteTitle.textContent = track.name;
    renderPlaylist();
    if(autoplay) play();
  }

  function play(){
    if(currentIndex === -1 && tracks.length) loadTrack(0);
    if(!audio.src) return;
    ensureAudioGraph();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    audio.play().catch(() => {});
    setPlayingIcon(true);
  }
  function pause(){ audio.pause(); setPlayingIcon(false); }

  function setPlayingIcon(playing){
    iconPlay.style.display = playing ? 'none' : 'block';
    iconPause.style.display = playing ? 'block' : 'none';
    reelLeft.classList.toggle('spin', playing);
    reelRight.classList.toggle('spin', playing);
    cassetteEl.classList.toggle('playing', playing);
  }

  btnPlay.addEventListener('click', () => { audio.paused ? play() : pause(); });

  function nextTrack(){
    if(!tracks.length) return;
    let next;
    if(isShuffle){
      if(tracks.length === 1) next = 0;
      else { do { next = Math.floor(Math.random() * tracks.length); } while(next === currentIndex); }
    } else { next = (currentIndex + 1) % tracks.length; }
    loadTrack(next, true);
  }
  function prevTrack(){
    if(!tracks.length) return;
    if(audio.currentTime > 3){ audio.currentTime = 0; return; }
    const prev = (currentIndex - 1 + tracks.length) % tracks.length;
    loadTrack(prev, true);
  }
  btnNext.addEventListener('click', nextTrack);
  btnPrev.addEventListener('click', prevTrack);
  btnShuffle.addEventListener('click', () => { isShuffle = !isShuffle; btnShuffle.classList.toggle('active', isShuffle); });
  btnRepeat.addEventListener('click', () => { isRepeat = !isRepeat; btnRepeat.classList.toggle('active', isRepeat); });

  audio.addEventListener('ended', () => {
    if(isRepeat){ audio.currentTime = 0; audio.play(); }
    else nextTrack();
  });

  // progress
  audio.addEventListener('loadedmetadata', () => {
    timeTotal.textContent = formatTime(audio.duration);
    seek.max = audio.duration || 0;
  });
  audio.addEventListener('timeupdate', () => {
    if(isSeeking) return;
    seek.value = audio.currentTime;
    timeCurrent.textContent = formatTime(audio.currentTime);
  });
  seek.addEventListener('input', () => { isSeeking = true; timeCurrent.textContent = formatTime(seek.value); });
  seek.addEventListener('change', () => { audio.currentTime = seek.value; isSeeking = false; });

  function formatTime(sec){ if(!isFinite(sec)) return '0:00'; const m = Math.floor(sec/60); const s = Math.floor(sec%60).toString().padStart(2,'0'); return `${m}:${s}`; }

  // volume
  volume.addEventListener('input', () => { audio.volume = volume.value / 100; });
  audio.volume = volume.value / 100;

  // keyboard
  document.addEventListener('keydown', (e) => {
    if(['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    if(e.code === 'Space'){ e.preventDefault(); btnPlay.click(); }
    if(e.code === 'ArrowRight'){ nextTrack(); }
    if(e.code === 'ArrowLeft'){ prevTrack(); }
  });

  // ---- visualizer ----
  function ensureAudioGraph(){
    if(audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    sourceNode = audioCtx.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }

  function resizeVisCanvas(){
    visCanvas.width = visCanvas.clientWidth * devicePixelRatio;
    visCanvas.height = visCanvas.clientHeight * devicePixelRatio;
  }
  window.addEventListener('resize', resizeVisCanvas);
  resizeVisCanvas();

  function drawVisualizer(){
    requestAnimationFrame(drawVisualizer);
    const w = visCanvas.width, h = visCanvas.height;
    visCtx.clearRect(0, 0, w, h);
    if(!analyser || audio.paused){
      visCtx.strokeStyle = 'rgba(232,169,74,0.25)';
      visCtx.lineWidth = 2;
      visCtx.beginPath();
      visCtx.moveTo(0, h/2);
      visCtx.lineTo(w, h/2);
      visCtx.stroke();
      return;
    }
    analyser.getByteFrequencyData(freqData);
    const barCount = freqData.length;
    const barWidth = w / barCount;
    for(let i = 0; i < barCount; i++){
      const value = freqData[i] / 255;
      const barHeight = value * h * 0.92;
      const x = i * barWidth;
      const y = (h - barHeight) / 2;
      const hue = 30 + value * 25;
      visCtx.fillStyle = `hsl(${hue}, 80%, ${55 + value * 20}%)`;
      visCtx.fillRect(x + 1, y, Math.max(barWidth - 2, 1), barHeight);
    }
  }
  drawVisualizer();

  // init
  loadDemoTracks();
})();