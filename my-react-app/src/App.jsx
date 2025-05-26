import React, { useState, useRef, useEffect } from "react";
import { ulid } from "ulid";
import { QRCodeSVG } from "qrcode.react";
import { Scanner } from "@yudiel/react-qr-scanner";
import './App.css'
const SIGNALING_SERVER_URL = "wss://dropit-9j77.onrender.com/ws";

export default function App() {
  const [logs, setLogs] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileNames, setFileNames] = useState([]);
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [role, setRole] = useState("");
  const ws = useRef(null);
  const pc = useRef(null);
  const dc = useRef(null);
  const receivedBuffers = useRef([]);
  const receivedSize = useRef(0);
  const fileMeta = useRef({ name: "", type: "", size: 0 });

  useEffect(() => {
    if (role === "sender") {
      const newRoomId = ulid();
      setRoomId(newRoomId);
    } else if (role === "receiver") {
      setRoomId(""); 
    }
  }, [role]);

  useEffect(() => {
    ws.current = new WebSocket(SIGNALING_SERVER_URL);

    ws.current.onopen = () => log("Connected to signaling server");

    ws.current.onmessage = async (msg) => {
      const data = JSON.parse(msg.data);
      if (data.sdp) {
        log(`Received SDP: ${data.sdp.type}`);
        await pc.current.setRemoteDescription(data.sdp);

        if (data.sdp.type === "offer") {
          const answer = await pc.current.createAnswer();
          await pc.current.setLocalDescription(answer);
          ws.current.send(
            JSON.stringify({ sdp: pc.current.localDescription, roomId })
          );
          log("Sent SDP answer");
        }
      } else if (data.candidate) {
        log("Received ICE candidate");
        try {
          await pc.current.addIceCandidate(data.candidate);
          log("Added ICE candidate");
        } catch (e) {
          console.error("Error adding ICE candidate", e);
        }
      }
    };

    setupPeerConnection();

    return () => {
      if (pc.current) pc.current.close();
      if (ws.current) ws.current.close();
    };
  }, [roomId]);

  function log(msg) {
    setLogs((prev) => [...prev, msg]);
  }

  function setupPeerConnection() {
    pc.current = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.current.onicecandidate = (event) => {
      if (event.candidate) {
        ws.current.send(JSON.stringify({ candidate: event.candidate, roomId }));
        log("Sent ICE candidate");
      }
    };

    pc.current.ondatachannel = (event) => {
      log("Received data channel");
      dc.current = event.channel;
      setupDataChannel();
    };
  }

  function setupDataChannel() {
    dc.current.binaryType = "arraybuffer";

    dc.current.onopen = () => log("Data channel opened");

    dc.current.onmessage = (event) => {
      if (typeof event.data === "string") {
        const meta = JSON.parse(event.data);
        fileMeta.current = meta;
        receivedBuffers.current = [];
        receivedSize.current = 0;
        log(`Receiving file: ${meta.name} (${meta.size} bytes)`);
      } else {
        receivedBuffers.current.push(event.data);
        receivedSize.current += event.data.byteLength;

        if (receivedSize.current === fileMeta.current.size) {
          log("File received completely. Preparing download...");
          const blob = new Blob(receivedBuffers.current, {
            type: fileMeta.current.type,
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileMeta.current.name;
          a.click();
          URL.revokeObjectURL(url);
          log("Download initiated");

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
    ws.current.send(
      JSON.stringify({ sdp: pc.current.localDescription, roomId })
    );
    log("Sent SDP offer");
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

    const chunkSize = 16 * 1024; 
    let fileIndex = 0;
    let offset = 0;
    const reader = new FileReader();

    function sendNextFile() {
      if (fileIndex >= files.length) {
        log("✅ All files sent successfully");
        return;
      }

      const file = files[fileIndex];
      offset = 0;

      log(`Sending file: ${file.name} (${file.size} bytes)`);
      dc.current.send(
        JSON.stringify({
          name: file.name,
          type: file.type,
          size: file.size,
        })
      );

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

      log(`Sent chunk of ${files[fileIndex].name}: ${offset} bytes`);

      if (offset < files[fileIndex].size) {
        readSlice(offset);
      } else {
        log(`✅ Finished sending ${files[fileIndex].name}`);
        dc.current.send("__END__");
        fileIndex++;
        sendNextFile();
      }
    };

    reader.onerror = (err) => {
      log(`❌ Error reading ${files[fileIndex].name}: ${err.message}`);
      fileIndex++;
      sendNextFile(); 
    };

    sendNextFile();
  }

  function joinRoom() {
    if (!roomId) return alert("Enter a Room ID to join");

    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ join: roomId }));
      log(`Joined room: ${roomId}`);
      setJoined(true);
    } else {
      alert("WebSocket is not connected");
    }
  }
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

  <button
    className="connect-btn"
    onClick={startConnection}
    disabled={!joined || !role}
  >
    🔗 Establish connection
  </button>
  <button
    className="upload-btn"
    onClick={sendFile}
    disabled={!files.length || !joined || role !== "sender"}
  >
    📤 Send File
  </button>

</div>

  );
  const Receiver = () => (
    <div className="receiver-container">
    {scanning ? (
      <Scanner
        onScan={handleScan}
        constraints={{ facingMode: 'environment' }}
        style={{ width: 200, height: 200 }}
      />
    ) : (
      <p>Successfully connected to {roomId}</p>
    )}
  </div>
  );
  const [scanning, setScanning] = useState(true);
  const handleScan = (result) => {
    if (result && result.length > 0) {
      const rawValue = result[0].rawValue;
      setRoomId(rawValue);
      setScanning(false);
    }
  };

  return (
    <div className="app-container">
      <h2 style={{textAlign:"center",color:"white"}}>Dropit P2P (Room-based)</h2>

      <div style={{ marginBottom: 10 }}>
        <label>
          Select Role:&nbsp;
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">-- Choose --</option>
            <option value="sender">Sender</option>
            <option value="receiver">Receiver</option>
          </select>
        </label>
      </div>

      {role === 'sender' && roomId && (
        <div className="qr-code-section">
          <QRCodeSVG value={roomId} />
          <h3 >Scan this to join</h3>
          {/* {{if(roomId){
            joinRoom()
          }
          }} */}
        </div>
      )}

      {role === 'receiver' && (
        <Receiver scanning={scanning} handleScan={handleScan} roomId={roomId} />
      )}

      <button onClick={joinRoom} disabled={joined || !role}>
        {joined ? 'Room Joined' : 'Create Room'}
      </button>

      {role === 'sender' && (
        <Sender
          handleFileChange={handleFileChange}
          fileNames={fileNames}
          sendFile={sendFile}
          files={files}
          joined={joined}
          role={role}
          startConnection={startConnection}
        />
      )}

      <h3>Logs:</h3>
      <div className="logs-container">
        {logs.map((log, i) => (
          <div key={i}>{log}</div>
        ))}
      </div>
    </div>
  );
}
