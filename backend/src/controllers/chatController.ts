import { Response } from 'express';
import { db } from '../config/firebase';
import { AuthenticatedRequest, Message } from '../types';
import { sendSuccess, sendError } from '../utils/response';
import { asyncHandler } from '../middleware/errorHandler';
import admin from '../config/firebase';
import { v4 as uuidv4 } from 'uuid';

const canAccess = async (meetingId:string, uid:string) => { const snap=await db.collection('meetings').doc(meetingId).get(); if(!snap.exists)return false; const d=snap.data()!; return d.hostId===uid || d.participants?.includes(uid); };

export const sendMessage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { meetingId } = req.params; if(!(await canAccess(meetingId,req.user!.uid))) return sendError(res,'Access denied',403);
  const { content, type='text', fileURL, fileName, fileSize } = req.body;
  const meeting=await db.collection('meetings').doc(meetingId).get(); if(meeting.data()?.settings?.chatEnabled===false)return sendError(res,'Chat is disabled',403);
  const id=uuidv4(); const msg:any={id,meetingId,senderId:req.user!.uid,senderName:req.user!.displayName||req.user!.email||'User',content,type,reactions:{},readBy:[req.user!.uid],createdAt:admin.firestore.FieldValue.serverTimestamp()};
  if(fileURL){msg.fileURL=fileURL;msg.fileName=fileName;msg.fileSize=fileSize;}
  await db.collection('messages').doc(id).set(msg); sendSuccess(res,{message:{...msg,createdAt:new Date().toISOString()}},'Sent',201);
});

export const getMessages = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { meetingId }=req.params; if(!(await canAccess(meetingId,req.user!.uid)))return sendError(res,'Access denied',403);
  const limit=Math.min(100,Math.max(1,Number(req.query.limit||50))); const snap=await db.collection('messages').where('meetingId','==',meetingId).limit(limit).get();
  const messages=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a:any,b:any)=>(a.createdAt?.toMillis?.()??0)-(b.createdAt?.toMillis?.()??0)); sendSuccess(res,{messages,hasMore:snap.size===limit});
});

export const reactToMessage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const doc=await db.collection('messages').doc(req.params.messageId).get(); if(!doc.exists)return sendError(res,'Not found',404); const msg=doc.data() as Message;
  if(!(await canAccess(msg.meetingId,req.user!.uid)))return sendError(res,'Access denied',403); const emoji=String(req.body.emoji||'').slice(0,16); if(!emoji)return sendError(res,'Emoji required',422); const users=msg.reactions?.[emoji]||[];
  await doc.ref.update({[`reactions.${emoji}`]:users.includes(req.user!.uid)?admin.firestore.FieldValue.arrayRemove(req.user!.uid):admin.firestore.FieldValue.arrayUnion(req.user!.uid)}); sendSuccess(res,{toggled:true});
});

export const editMessage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => { const doc=await db.collection('messages').doc(req.params.messageId).get(); if(!doc.exists)return sendError(res,'Not found',404); if(doc.data()?.senderId!==req.user!.uid)return sendError(res,'Forbidden',403); const content=String(req.body.content||'').trim(); if(!content||content.length>5000)return sendError(res,'Invalid message',422); await doc.ref.update({content,editedAt:admin.firestore.FieldValue.serverTimestamp()}); sendSuccess(res,{updated:true}); });
export const deleteMessage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => { const doc=await db.collection('messages').doc(req.params.messageId).get(); if(!doc.exists)return sendError(res,'Not found',404); const d=doc.data()!; if(d.senderId!==req.user!.uid&&req.user!.role!=='admin')return sendError(res,'Forbidden',403); await doc.ref.update({content:'[Message deleted]',deletedAt:admin.firestore.FieldValue.serverTimestamp()}); sendSuccess(res,{deleted:true}); });
export const markMessagesRead = asyncHandler(async (req: AuthenticatedRequest, res: Response) => { if(!(await canAccess(req.params.meetingId,req.user!.uid)))return sendError(res,'Access denied',403); const snap=await db.collection('messages').where('meetingId','==',req.params.meetingId).limit(100).get(); const batch=db.batch(); snap.docs.forEach(d=>{if(!(d.data().readBy||[]).includes(req.user!.uid))batch.update(d.ref,{readBy:admin.firestore.FieldValue.arrayUnion(req.user!.uid)});}); if(!snap.empty)await batch.commit(); sendSuccess(res,{marked:snap.size}); });
