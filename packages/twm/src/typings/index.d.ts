declare type FileResourceMap = {
    // 仅仅需要第一次拷贝，也不会修改，例如 node_modules，typings
    onlyCopy: FileResource[];
    // 在扩展下，需要额外处理翻译的文件，例如 pages 下的 js
    translateMap: Map<FileResource, FileResource>;
    // 在扩展下，不需要额外处理翻译的文件，例如 utils 下的 js
    normalMap: Map<FileResource, FileResource>;
    // 除了以上之外的文件，例如 html/css
    modification: FileResource[];
};

declare class FileResource {
    constructor ( sourceAbsolutePath: string, distAbsolutePath: string );
    
    filename: string;
    sourceAbsolutePath: string;
    distAbsolutePath: string;
    sourceCode: string;
    ast: any;
    extname: string;
}

declare class ContextResource {
    inputPath: string;
    outputPath: string;
    extensions: IExtension[];
    fileResourceMap: FileResourceMap;
    fileResources: FileResource[];
    lang: string;
    buildPath: string;
    [key: string]: any;

    set ( key: string, value: any ): void;

}

// declare interface IMiddleware {
//     apply: ( twm: Twm, context: ContextResource ) => void;
// }

declare interface IExtension {
    extname: string;
    replace?: string;
    translate: ( context: ContextResource, target: FileResource, source: FileResource ) => void;
}