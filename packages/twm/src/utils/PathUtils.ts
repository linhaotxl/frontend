import path from 'path';

export const basename = ( p: string, e?: string ) => path.basename( p, e );

export const relativePath = ( from: string, to: string ) => path.relative( from, to ); 

export const absolutePath = ( relativePath: string ) => path.resolve( relativePath );

export const joinPath = ( ...paths: string[] ) => path.join( ...paths );

export const dirname = ( p: string ) => path.dirname( p );

export const extname = ( p: string ) => path.extname( p );