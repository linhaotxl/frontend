import fse from 'fs-extra';
import fs from 'fs';

export const writeFile = (
    file: string,
    data: any,
    options?: string | fse.WriteFileOptions
) => fse.outputFile( file, data, options );

export const copyFile = (
    src: string,
    dest: string,
    options?: fse.CopyOptions
) => fse.copy( src, dest, options );

export const readFileSync = (
    p: fs.PathLike | number,
    options?: { encoding?: BufferEncoding; flag?: string; }
) => fse.readFileSync( p, options );