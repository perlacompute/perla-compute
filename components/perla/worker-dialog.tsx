'use client';
import Link from 'next/link';
import { Modal } from '@/components/auren/shared';
import styles from './worker-identity.module.css';
export function WorkerDialog({ onClose }: { onClose: () => void; onCreated: () => void }) {
 return <Modal title="Connect a worker" onClose={onClose}><div className={styles.choices}><Link className={styles.choice} href="/platform/setup"><strong>Create new worker</strong><p>Choose a name and public reward wallet. The CLI creates a permanent ID on its first connection and saves its credential privately.</p></Link><Link className={styles.choice} href="/platform/setup?reuse=1"><strong>Use existing worker</strong><p>Move a worker to another VPS or GPU machine. Keep its ID, name, wallet and recorded work. Authorize the replacement with the owner wallet.</p></Link></div><p className={styles.help}>Find permanent IDs in your worker list. Reconnecting needs no manual configuration-file transfer.</p></Modal>;
}
