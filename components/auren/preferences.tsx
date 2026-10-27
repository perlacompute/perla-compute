'use client';
import { useEffect } from 'react';
export function Preferences() { useEffect(() => { try {
    const p = JSON.parse(localStorage.getItem('auren.preferences.v1') || '{}');
    document.documentElement.dataset.density = p.density === 'compact' ? 'compact' : 'comfortable';
    document.documentElement.dataset.motion = p.motion === false ? 'reduced' : 'full';
}
catch { } }, []); return null; }
