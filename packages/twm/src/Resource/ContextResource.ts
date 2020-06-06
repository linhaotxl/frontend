import { ELang } from "../utils/Build";

export class ContextResource {
    inputPath: string = '';
    outputPath: string = '';
    extensions: IExtension[] = [];
    fileResourceMap: FileResourceMap = { onlyCopy: [], translateMap: new Map(), normalMap: new Map(), modification: [] };
    fileResources: FileResource[] = [];
    lang: ELang;
    buildPath: string;
    [key: string]: any;

    constructor () {}

    set ( key: string, value: any ) {
        this[ key ] = value;
    }

}