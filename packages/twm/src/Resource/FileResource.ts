import { extname, basename } from '../utils/PathUtils';

export class FileResource {
    filename: string = '';
    sourceAbsolutePath: string = '';
    distAbsolutePath: string = '';
    ast: any = null;
    sourceCode: string = '';
    extname: string = '';

    constructor ( sourceAbsolutePath: string, distAbsolutePath: string ) {
        this.filename = basename( sourceAbsolutePath );
        this.sourceAbsolutePath = sourceAbsolutePath;
        this.distAbsolutePath = distAbsolutePath;
        this.extname = extname( sourceAbsolutePath );
    }
}