// SALT OKUNUR yedek: Firestore'da hiçbir belgeyi değiştirmez veya silmez.
// Örnek: node scripts/backup-firestore.mjs /guvenli-klasor/sgm-2026-11-23.json
// Firebase Admin ortam değişkenleri yerel terminalde ayarlanmış olmalıdır.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '../server/firebase-admin.js';

const destination=process.argv[2];
if(!destination || !destination.endsWith('.json')) {
  console.error('Kullanım: node scripts/backup-firestore.mjs /güvenli/yol/sgm-yedek.json');
  process.exit(2);
}
const appId=process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID;
if(!appId)throw new Error('FIREBASE_APP_ID eksik. Yanlış projeye yedek alınamaz.');
const db=getFirestore(adminApp());
const root=db.doc(`artifacts/${appId}/public/data`);
const collections=await root.listCollections();
const backup={format:'sgm-firestore-readonly-backup',createdAt:new Date().toISOString(),appId,collections:{}};
for(const group of collections) {
  const snapshot=await group.get();
  backup.collections[group.id]=snapshot.docs.map(doc=>({id:doc.id,data:doc.data()}));
  console.log(`${group.id}: ${snapshot.size} belge okundu`);
}
const path=resolve(destination);
await mkdir(dirname(path),{recursive:true});
await writeFile(path,JSON.stringify(backup,null,2),{encoding:'utf8',flag:'wx',mode:0o600});
console.log('Yedek tamamlandı. Hassas öğrenci verileri içerir; paylaşmayın:',path);
