import React, { useState, useRef, useEffect } from "react";
import { ulid } from "ulid";
import { QRCodeSVG } from "qrcode.react";
import { Scanner } from "@yudiel/react-qr-scanner";
import './App.css';

const SIGNALING_SERVER_URL = process.env.WEBSIGNAL;

export default function App() {
  const [notification, setNotification] = useState("");
  const [files, setFiles] = useState([]);
  const [fileNames, setFileNames] = useState([]);
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [role, setRole] = useState("");
  const [scanning, setScanning] = useState(true);

  const ws = useRef(null);
  const pc = useRef(null);
  const dc = useRef(null);
  const receivedBuffers = useRef([]);
  const receivedSize = useRef(0);
  const fileMeta = useRef({ name: "", type: "", size: 0 });

useEffect(() => {
  if (role === "sender") {
    const id = ulid();
    setRoomId(id);
    notify(`Room created: ${id}`, true); // persistent until overwritten
  } else {
    setRoomId("");
  }
}, [role]);


  useEffect(() => {
    ws.current = new WebSocket(SIGNALING_SERVER_URL);

    ws.current.onopen = () => notify("Connected to signaling server");

    ws.current.onmessage = async (msg) => {
      const data = JSON.parse(msg.data);
      if (data.sdp) {
        await pc.current.setRemoteDescription(data.sdp);
        if (data.sdp.type === "offer") {
          const answer = await pc.current.createAnswer();
          await pc.current.setLocalDescription(answer);
          ws.current.send(JSON.stringify({ sdp: pc.current.localDescription, roomId }));
        }
      } else if (data.candidate) {
        try {
          await pc.current.addIceCandidate(data.candidate);
        } catch (e) {
          console.error("Error adding ICE candidate", e);
        }
      }
    };

    setupPeerConnection();

    return () => {
      pc.current?.close();
      ws.current?.close();
    };
  }, [roomId]);

 function notify(msg, persistent = false) {
  setNotification(msg);
  if (!persistent) {
    setTimeout(() => setNotification(""), 2000);
  }
}


  function setupPeerConnection() {
    pc.current = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.current.onicecandidate = (event) => {
      if (event.candidate) {
        ws.current.send(JSON.stringify({ candidate: event.candidate, roomId }));
      }
    };

    pc.current.ondatachannel = (event) => {
      dc.current = event.channel;
      setupDataChannel();
    };
  }

  function setupDataChannel() {
    dc.current.binaryType = "arraybuffer";

    dc.current.onopen = () => notify("Connection established");

    dc.current.onmessage = (event) => {
      if (typeof event.data === "string") {
        const meta = JSON.parse(event.data);
        fileMeta.current = meta;
        receivedBuffers.current = [];
        receivedSize.current = 0;
      } else {
        receivedBuffers.current.push(event.data);
        receivedSize.current += event.data.byteLength;

        if (receivedSize.current === fileMeta.current.size) {
          const blob = new Blob(receivedBuffers.current, {
            type: fileMeta.current.type,
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileMeta.current.name;
          a.click();
          URL.revokeObjectURL(url);
          notify(`Download started: ${fileMeta.current.name}`);
          receivedBuffers.current = [];
          receivedSize.current = 0;
          fileMeta.current = { name: "", type: "", size: 0 };
        }
      }
    };
  }

  async function startConnection() {
    if (!roomId) return alert("Please enter a room ID first.");

    dc.current = pc.current.createDataChannel("fileTransfer");
    setupDataChannel();

    const offer = await pc.current.createOffer();
    await pc.current.setLocalDescription(offer);
    ws.current.send(JSON.stringify({ sdp: pc.current.localDescription, roomId }));
    notify("Waiting for connection...");
  }

  const handleFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files);
    setFiles(selectedFiles);
    setFileNames(selectedFiles.map((file) => file.name));
  };

 function sendFile() {
  if (!files.length || !dc.current || dc.current.readyState !== "open") {
    alert("Data channel is not open or no files selected");
    return;
  }

  notify("Sending...", true); // persistent sending notification

  const chunkSize = 16 * 1024;
  let fileIndex = 0;
  let offset = 0;
  const reader = new FileReader();

  function sendNextFile() {
    if (fileIndex >= files.length) {
      notify("All files sent successfully");
      return;
    }

    const file = files[fileIndex];
    offset = 0;

    dc.current.send(JSON.stringify({ name: file.name, type: file.type, size: file.size }));
    readSlice(0);
  }

  function readSlice(o) {
    const file = files[fileIndex];
    const slice = file.slice(o, o + chunkSize);
    reader.readAsArrayBuffer(slice);
  }

  reader.onload = (e) => {
    const buffer = e.target.result;
    dc.current.send(buffer);
    offset += buffer.byteLength;

    if (offset < files[fileIndex].size) {
      readSlice(offset);
    } else {
      notify(`Sent: ${files[fileIndex].name}`, false);
      fileIndex++;
      sendNextFile();
    }
  };

  reader.onerror = () => {
    notify(`Error reading file: ${files[fileIndex].name}`, false);
    fileIndex++;
    sendNextFile();
  };

  sendNextFile();
}


  function joinRoom() {
    if (!roomId) return alert("Enter a Room ID to join");
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ join: roomId }));
      setJoined(true);
      notify(`Joined room: ${roomId}`);
    } else {
      alert("WebSocket is not connected");
    }
  }

  const handleScan = (result) => {
    if (result && result.length > 0) {
      setRoomId(result[0].rawValue);
      setScanning(false);
    }
  };

  const Sender = () => (
    <div className="file-upload-container">
      <label htmlFor="file-upload" className="file-upload-label">
        <span>📁 Choose Files</span>
        <input
          id="file-upload"
          type="file"
          multiple
          onChange={handleFileChange}
          className="file-upload-input"
        />
      </label>
      <div className="file-list">
        {fileNames.map((name, index) => (
          <p key={index} className="file-name">{name}</p>
        ))}
      </div>
      <button className="connect-btn" onClick={startConnection} disabled={!joined}>
        🔗 Establish connection
      </button>
      <button className="upload-btn" onClick={sendFile} disabled={!files.length || !joined}>
        📤 Send File
      </button>
    </div>
  );

  const Receiver = () => (<>
  <div className="receiver">
    <div className="receiver-container">
  {scanning ? (
    <Scanner
      onScan={handleScan}
      constraints={{ facingMode: 'environment' }}
      style={{ width: 200, height: 200 }}
    />
  ) : (
    <>
      <p>Connected to Room: {roomId}</p>
    </>
  )}
</div>

{!scanning && (
  
    <video
      className="receiving-video"
      src="/animation.mp4"
      autoPlay
      loop
      muted
      playsInline
      style={{borderRadius:"10px"}}
    />
)}</div>
</>
  );

  return (<>
    <div className="header">
        <h2>Dropit P2P</h2>
        <div className="toggle-role">
          <button onClick={() => setRole(role === "sender" ? "receiver" : "sender")}>
            Switch to {role === "sender" ? "Receiver" : "Sender"}
          </button>
        </div>
      </div>
    <div className="app-container">
      {notification && <div className="notification-banner">{notification}</div>}

      

      {role === "sender" && roomId && (
        <div className="qr-code-section">
          <QRCodeSVG value={roomId} />
          <p>Scan this QR to join</p>
        </div>
      )}

      {role === "receiver" && (
        <Receiver scanning={scanning} handleScan={handleScan} roomId={roomId} />
      )}
      
      <button className="main" onClick={joinRoom} disabled={joined || !role}>
      {joined ? (role === "sender" ? "Joined Room" : "Join Room") : "Join Room"}

      </button>

      {role === "sender" && <Sender />}
    </div></>
  );
}
