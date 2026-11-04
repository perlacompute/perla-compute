import type {MetadataRoute} from 'next';
export default function robots():MetadataRoute.Robots{return {rules:{userAgent:'*',allow:'/',disallow:['/api/','/platform/reconnect','/platform/settings','/platform/keys']},sitemap:'https://perlacompute.xyz/sitemap.xml'};}
