// src/App.jsx
import React, { useState, useRef, useEffect } from "react";
const SIGNALING_SERVER_URL = "wss://dropit-9j77.onrender.com/ws";

export default function App() {
  const [logs, setLogs] = useState([]);
  const [file, setFile] = useState(null);

  const ws = useRef(null);
  const pc = useRef(null);
  const dc = useRef(null);

  const receivedBuffers = useRef([]);
  const receivedSize = useRef(0);
  const fileMeta = useRef({ name: "", type: "", size: 0 });

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
          ws.current.send(JSON.stringify({ sdp: pc.current.localDescription }));
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
  }, []);

  function log(msg) {
    setLogs((logs) => [...logs, msg]);
  }

  function setupPeerConnection() {
    pc.current = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.current.onicecandidate = (event) => {
      if (event.candidate) {
        ws.current.send(JSON.stringify({ candidate: event.candidate }));
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
          const blob = new Blob(receivedBuffers.current, { type: fileMeta.current.type });
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
    dc.current = pc.current.createDataChannel("fileTransfer");
    setupDataChannel();

    const offer = await pc.current.createOffer();
    await pc.current.setLocalDescription(offer);
    ws.current.send(JSON.stringify({ sdp: pc.current.localDescription }));
    log("Sent SDP offer");
  }

  function handleFileChange(e) {
    setFile(e.target.files[0]);
  }

  function sendFile() {
    if (!file || !dc.current || dc.current.readyState !== "open") {
      alert("Data channel is not open or no file selected");
      return;
    }

    log(`Sending file: ${file.name} (${file.size} bytes)`);
    dc.current.send(JSON.stringify({ name: file.name, type: file.type, size: file.size }));

    const chunkSize = 16 * 1024;
    let offset = 0;

    const reader = new FileReader();
    reader.onload = (e) => {
      dc.current.send(e.target.result);
      offset += e.target.result.byteLength;
      log(`Sent chunk: ${offset} bytes`);

      if (offset < file.size) {
        readSlice(offset);
      } else {
        log("File sent successfully");
      }
    };

    reader.onerror = (err) => {
      log("File read error: " + err);
    };

    function readSlice(o) {
      const slice = file.slice(o, o + chunkSize);
      reader.readAsArrayBuffer(slice);
    }

    readSlice(0);
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>WebRTC P2P File Transfer (React + Spring Boot)</h2>

      <button onClick={startConnection}>Connect (Create Offer)</button>

      <div style={{ marginTop: 10 }}>
        <input type="file" onChange={handleFileChange} />
        <button onClick={sendFile} disabled={!file}>
          Send File
        </button>
      </div>

      <h3>Logs:</h3>
      <div
        style={{
          width: "80vw",
          height: "300px",
          overflowY: "auto",
          backgroundColor: "#f0f0f0",
          padding: 10,
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          border: "1px solid #ccc",
        }}
      >
        {logs.map((log, i) => (
          <div key={i}>{log}</div>
        ))}
      </div>
    </div>
  );
}
