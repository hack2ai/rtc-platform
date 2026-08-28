import { Response } from 'express';
import { db } from '../config/firebase';
import { AuthenticatedRequest, Message } from '../types';
import { sendSuccess, sendError } from '../utils/response';
import { asyncHandler } from '../middleware/errorHandler';
import admin from '../config/firebase';
import { v4 as uuidv4 } from 'uuid';

export const sendMessage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { meetingId } = req.params; const { content, type='text', fileURL, fileName, fileSize } = req.body;
  const now=admin.firestore.FieldValue.serverTimestamp(); const id=uuidv4();
  const msg:any={id,meetingId,senderId:req.user!.uid,senderName:req.user!.displayName||req.user!.email,content,type,reactions:{},readBy:[req.user!.uid],createdAt:now};
  if(fileURL){msg.fileURL=fileURL;msg.fileName=fileName;msg.fileSize=fileSize;}
  await db.collection('messages').doc(id).set(msg);
  sendSuccess(res,{message:msg},'Sent',201);
});

export const getMessages = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { meetingId }=req.params; const { limit=50 }=req.query;
  const snap=await db.collection('messages').where('meetingId','==',meetingId).orderBy('createdAt','desc').limit(Number(limit)).get();
  const messages=snap.docs.map(d=>({id:d.id,...d.data()})).reverse();
  sendSuccess(res,{messages,hasMore:snap.size===Number(limit)});
});

export const reactToMessage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {messageId}=req.params; const {emoji}=req.body; const uid=req.user!.uid;
  const doc=await db.collection('messages').doc(messageId).get();
  if(!doc.exists){sendError(res,'Not found',404);return;}
  const msg=doc.data() as Message; const users=msg.reactions[emoji]||[];
  if(users.includes(uid)) await db.collection('messages').doc(messageId).update({[`reactions.${emoji}`]:admin.firestore.FieldValue.arrayRemove(uid)});
  else await db.collection('messages').doc(messageId).update({[`reactions.${emoji}`]:admin.firestore.FieldValue.arrayUnion(uid)});
  sendSuccess(res,{toggled:true});
});

export const editMessage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {messageId}=req.params; const doc=await db.collection('messages').doc(messageId).get();
  if(!doc.exists){sendError(res,'Not found',404);return;}
  if(doc.data()?.senderId!==req.user!.uid){sendError(res,'Forbidden',403);return;}
  await db.collection('messages').doc(messageId).update({content:req.body.content,editedAt:admin.firestore.FieldValue.serverTimestamp()});
  sendSuccess(res,{updated:true});
});

export const deleteMessage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {messageId}=req.params; const doc=await db.collection('messages').doc(messageId).get();
  if(!doc.exists){sendError(res,'Not found',404);return;}
  if(doc.data()?.senderId!==req.user!.uid&&req.user!.role!=='admin'){sendError(res,'Forbidden',403);return;}
  await db.collection('messages').doc(messageId).update({content:'[Message deleted]',deletedAt:admin.firestore.FieldValue.serverTimestamp()});
  sendSuccess(res,{deleted:true});
});

export const markMessagesRead = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {meetingId}=req.params; const uid=req.user!.uid;
  const snap=await db.collection('messages').where('meetingId','==',meetingId).limit(100).get();
  const batch=db.batch(); snap.docs.forEach(d=>{if(!(d.data().readBy||[]).includes(uid))batch.update(d.ref,{readBy:admin.firestore.FieldValue.arrayUnion(uid)});});
  await batch.commit(); sendSuccess(res,{marked:snap.size});
});
