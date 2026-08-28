import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: { uid: string; email: string; displayName?: string; role?: string };
}

export interface Meeting {
  id: string; code: string; title: string; description?: string;
  hostId: string; hostName: string;
  status: 'scheduled' | 'active' | 'ended' | 'cancelled';
  scheduledAt?: any; startedAt?: any; endedAt?: any; duration?: number;
  settings: MeetingSettings;
  participants: string[]; waitingRoom: string[]; bannedUsers: string[];
  recordingEnabled: boolean; recordingId?: string;
  isLocked: boolean; password?: string; maxParticipants: number;
  createdAt: any; updatedAt: any;
}

export interface MeetingSettings {
  waitingRoomEnabled: boolean; hostApprovalRequired: boolean;
  chatEnabled: boolean; screenShareEnabled: boolean;
  fileShareEnabled: boolean; whiteboardEnabled: boolean;
  recordingEnabled: boolean; muteOnEntry: boolean;
  videoOnEntry: boolean; allowParticipantRename: boolean;
}

export interface Message {
  id: string; meetingId: string; senderId: string; senderName: string;
  content: string; type: 'text'|'file'|'image'|'system';
  fileURL?: string; fileName?: string; fileSize?: number;
  reactions: Record<string, string[]>; readBy: string[];
  editedAt?: any; deletedAt?: any; createdAt: any;
}

export interface Participant {
  uid: string; meetingId: string; displayName: string; photoURL?: string;
  role: 'host'|'co-host'|'participant';
  status: 'waiting'|'active'|'left'|'removed'|'banned';
  audioEnabled: boolean; videoEnabled: boolean;
  screenSharing: boolean; handRaised: boolean;
  joinedAt: any; leftAt?: any;
  connectionQuality: 'excellent'|'good'|'poor'|'disconnected';
}

export interface FileShare {
  id: string; meetingId: string; uploaderId: string; uploaderName: string;
  name: string; type: string; size: number; url: string;
  thumbnailURL?: string; createdAt: any;
}

export interface Recording {
  id: string; meetingId: string; meetingTitle: string; hostId: string;
  startedAt: any; endedAt?: any; duration?: number;
  fileURL?: string; fileSize?: number;
  status: 'recording'|'processing'|'available'|'failed';
  createdAt: any;
}

export interface Notification {
  id: string; userId: string;
  type: 'meeting_invite'|'meeting_start'|'participant_join'|'participant_leave'|'chat_message'|'recording_ready';
  title: string; body: string; data?: Record<string,string>;
  read: boolean; createdAt: any;
}
