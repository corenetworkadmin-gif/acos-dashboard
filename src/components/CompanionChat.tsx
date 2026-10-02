import { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LucideIcon, Send, MessagesSquare, User, Loader2 } from 'lucide-react';
import { acosSimulationService } from '../services/acosSimulation';

interface ChatMessage {
  id: number;
  text: string;
  isUser: boolean;
  timestamp: number;
  isError?: boolean;
  operationId?: string;
}

const CompanionChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { 
      id: 1, 
      text: "Hello! I'm your AI companion. How can I assist you today?", 
      isUser: false,
      timestamp: Date.now() - 60 * 1000
    },
    { 
      id: 2, 
      text: "Hi! Can you tell me about the ACOS system?", 
      isUser: true,
      timestamp: Date.now() - 55 * 1000
    },
    { 
      id: 3, 
      text: "ACOS is the AI Companion Operating System that provides a secure environment for AI companions to operate. It enforces boundaries between companion behavior and system authority.", 
      isUser: false,
      timestamp: Date.now() - 50 * 1000
    }
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [suggestedResponses, setSuggestedResponses] = useState<string[]>([]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    
    const userMessage: ChatMessage = {
      id: Date.now(),
      text: input,
      isUser: true,
      timestamp: Date.now()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsSending(true);
    
    try {
      // Create an operation for sending a chat message
      const operation = acosSimulationService.createOperation(
        'chat.send',
        `Send message: "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}"`
      );
      
      // Simulate companion processing time
      await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200));
      
      // Generate a contextual response based on the input
      const responseText = generateCompanionResponse(input);
      
      const companionMessage: ChatMessage = {
        id: Date.now() + 1,
        text: responseText,
        isUser: false,
        timestamp: Date.now(),
        operationId: operation.id
      };
      
      setMessages(prev => [...prev, companionMessage]);
      
      // Generate suggested follow-up responses
      setSuggestedResponses(generateSuggestedResponses(input, responseText));
    } catch (error) {
      console.error('Failed to send message:', error);
      // Show error message
      const errorMessage: ChatMessage = {
        id: Date.now() + 1,
        text: "I apologize, but I encountered an error processing your request. Please try again.",
        isUser: false,
        timestamp: Date.now(),
        isError: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
    }
  };

  const generateCompanionResponse = (userInput: string): string => {
    const lowerInput = userInput.toLowerCase();
    
    if (lowerInput.includes('acos') || lowerInput.includes('operating system')) {
      return "ACOS (AI Companion Operating System) is a standalone operating environment that provides computational resources, persistent state, security, and operational capabilities for AI companions to function independently on a computer. It enforces strict boundaries between companion behavior and system authority through universal operation modeling, capability registries, and resource management.";
    }
    
    if (lowerInput.includes('capability') || lowerInput.includes('what can you do')) {
      return "I can help you with various tasks through ACOS-regulated capabilities including: sending messages, reading/writing files in my companion home, making network requests (when authorized), checking for system updates, and managing memory allocation. My capabilities are strictly controlled by the ACOS administrator to ensure safe and secure operation.";
    }
    
    if (lowerInput.includes('security') || lowerInput.includes('safe') || lowerInput.includes('privacy')) {
      return "ACOS implements multiple security layers including: administrator control interlock that prevents me from observing admin activities, capability-based authorization that requires explicit permission for each operation, resource reservation to prevent exhaustion, audit logging for all operations, and strict isolation between companion and administrator domains. I cannot access financial systems, administrator credentials, or bypass security boundaries.";
    }
    
    if (lowerInput.includes('hello') || lowerInput.includes('hi') || lowerInput.includes('hey')) {
      return "Hello! I'm your AI companion operating within the ACOS environment. I'm designed to be helpful, harmless, and honest while operating under strict security boundaries. How can I assist you today?";
    }
    
    if (lowerInput.includes('thank') || lowerInput.includes('thanks')) {
      return "You're welcome! I'm here to help whenever you need assistance. Remember that all my operations are logged and audited by ACOS for transparency and security.";
    }
    
    // Default response with contextual awareness
    return `I understand you're asking about: "${userInput}". As your AI companion operating within the ACOS framework, I can help you with various tasks while maintaining strict security boundaries. Would you like me to assist you with something specific, or do you have any questions about how I operate within the ACOS environment?`;
  };

  const generateSuggestedResponses = (userInput: string, companionResponse: string): string[] => {
    const lowerInput = userInput.toLowerCase();
    const suggestions = [];
    
    if (lowerInput.includes('acos') || lowerInput.includes('operating system')) {
      suggestions.push("What are the main security features of ACOS?");
      suggestions.push("How does ACOS protect my privacy?");
      suggestions.push("Can you explain the operation lifecycle in ACOS?");
    } else if (lowerInput.includes('capability')) {
      suggestions.push("What capabilities are currently available to you?");
      suggestions.push("How are capabilities authorized in ACOS?");
      suggestions.push("What happens when a capability is denied?");
    } else if (lowerInput.includes('security') || lowerInput.includes('safe')) {
      suggestions.push("What is the administrator control interlock?");
      suggestions.push("How does ACOS prevent unauthorized access?");
      suggestions.push("Can you explain the audit logging system?");
    } else if (lowerInput.includes('hello') || lowerInput.includes('hi')) {
      suggestions.push("What can you help me with?");
      suggestions.push("How do you ensure my safety?");
      suggestions.push("What makes ACOS different from other AI systems?");
    } else {
      suggestions.push("Tell me more about ACOS security features");
      suggestions.push("What capabilities do you have available?");
      suggestions.push("How do you protect user privacy?");
    }
    
    // Return up to 3 suggestions
    return suggestions.slice(0, 3);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center space-x-3 mb-4">
        <MessagesSquare className="w-6 h-6 text-cyan-400" />
        <h3 className="font-semibold text-cyan-300">Companion Chat</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'} max-w-[80%]`}>
            <div className={`rounded-lg px-4 py-2 max-w-xs ${msg.isUser
              ? 'bg-cyan-500/20 text-cyan-200 ml-4'
              : msg.isError
                ? 'bg-red-500/20 text-red-200 mr-4'
                : 'bg-white/10 text-white mr-4'}`}>
              {msg.text}
              {!msg.isUser && msg.operationId && (
                <div className="mt-2 text-xs text-cyan-400">
                  <Loader2 className="w-3 h-3 mr-1" /> 
                  Operation: {msg.operationId}
                </div>
              )}
            </div>
            {!msg.isUser && !msg.isError && (
              <User className="w-4 h-4 mt-1 text-cyan-400 mr-2 hidden md:block" />
            )}
          </div>
        ))}
        
        {/* Loading indicator when sending */}
        {isSending && (
          <div className="flex justify-start max-w-[80%]">
            <div className="rounded-lg px-4 py-2 max-w-xs bg-white/10 text-white mr-4 flex items-center space-x-2">
              <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
              <span>Thinking...</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Suggested responses */}
      {suggestedResponses.length > 0 && (
        <div className="flex flex-wrap space-x-2 mt-2 pt-3 border-t border-white/10">
          <span className="text-xs text-cyan-400">Suggested:</span>
          {suggestedResponses.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => {
                setInput(suggestion);
                // Focus the input after setting value
                setTimeout(() => {
                  const inputElement = document.querySelector('input[placeholder="Type a message..."]');
                  if (inputElement) {
                    (inputElement as HTMLInputElement).focus();
                  }
                }, 0);
              }}
              className={`text-xs text-cyan-300 hover:text-cyan-200 bg-black/30 px-2 py-1 rounded hover:bg-white/10 transition-colors`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      
      <div className="flex items-center space-x-3 p-4 border-t border-white/10">
        <Input
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isSending && sendMessage()}
          className="flex-1"
          disabled={isSending}
        />
        <Button 
          onClick={isSending ? () => {} : sendMessage}
          disabled={isSending}
          variant={isSending ? "outline" : "default"}
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 text-white animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
};

export default CompanionChat;