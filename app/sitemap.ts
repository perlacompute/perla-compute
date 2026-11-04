import type {MetadataRoute} from 'next';
export default function sitemap():MetadataRoute.Sitemap{
 return ['/','/platform/setup','/docs','/whitepaper','/participate','/explorer','/rewards','/status'].map(path=>({url:'https://perlacompute.xyz'+(path==='/'?'':path),lastModified:'2026-11-04',changeFrequency:path==='/status'?'hourly' as const:'weekly' as const,priority:path==='/'?1:path==='/platform/setup'?0.9:0.7}));
}
