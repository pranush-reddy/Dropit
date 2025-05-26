package com.example.Drop;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.Map;
import java.util.Set;

public class SignalingHandler extends TextWebSocketHandler {

    private final ObjectMapper objectMapper = new ObjectMapper();

    private final Map<String, Set<WebSocketSession>> rooms = new ConcurrentHashMap<>();
    private final Map<WebSocketSession, String> sessionRoomMap = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String roomId = sessionRoomMap.get(session);
        if (roomId != null && rooms.containsKey(roomId)) {
            rooms.get(roomId).remove(session);
            if (rooms.get(roomId).isEmpty()) {
                rooms.remove(roomId);
            }
        }
        sessionRoomMap.remove(session);
        System.out.println("Session closed: " + session.getId() + ", removed from room " + roomId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode json = objectMapper.readTree(message.getPayload());
        System.out.println("Received from " + session.getId() + ": " + message.getPayload());

        if (json.has("join")) {
            String roomId = json.get("join").asText();
            rooms.computeIfAbsent(roomId, k -> new CopyOnWriteArraySet<>()).add(session);
            sessionRoomMap.put(session, roomId);
            System.out.println("Session " + session.getId() + " joined room " + roomId);
            return;
        }

        String roomId = json.has("roomId") ? json.get("roomId").asText() : sessionRoomMap.get(session);
        if (roomId == null || !rooms.containsKey(roomId)) {
            System.out.println("No valid room for session " + session.getId());
            return;
        }

        for (WebSocketSession peer : rooms.get(roomId)) {
            if (!peer.equals(session) && peer.isOpen()) {
                System.out.println("Forwarding message from " + session.getId() + " to " + peer.getId());
                peer.sendMessage(message);
            }
        }
    }
}
