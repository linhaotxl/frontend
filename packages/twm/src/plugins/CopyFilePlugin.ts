import Twm, { IMiddleware } from "../TwmWatcher";
// import { ContextResource } from "../Resource/ContextResource";
import { copyFile, writeFile } from '../utils/FsUtils';

export class CopyFilePlugin implements IMiddleware {
    apply ( twm: Twm ) {
        twm.hooks.changeFileHooks.tapPromise( 'CopyFile', ( context: ContextResource, fileResources: FileResource[] ) => new Promise( async resolve => {
            await this.resolveGenerateDist( context, fileResources );
            resolve( context );
        }));
    }

    getWriteMapFiles (
        maps: Map<FileResource, FileResource>,
        writeFiles: Set<FileResource>,
        copyFiles: Set<FileResource>
    ) {
        for ( const [ source, target ] of maps.entries() ) {
            writeFiles.add( target );
            copyFiles.add( source )
        }
    }

    getCopyMapFiles ( maps: Map<FileResource, FileResource> ) {
        const files: FileResource[] = [];
        for ( const [ source, target ] of maps.entries() ) {
            files.push( source, target );
        }
        return files;
    }

    async resolveGenerateDist ( context: ContextResource, fileResources: FileResource[] ) {
        const { fileResourceMap: { onlyCopy, translateMap, normalMap, modification } } = context;
        let copyFiles  = new Set<FileResource>();
        let writeFiles = new Set<FileResource>();

        if ( Array.isArray( fileResources ) && fileResources.length ) {
            // 有改动的文件，遍历改动文件列表
            fileResources.forEach( changeFile => {
                console.log( 'changeFile -> ', changeFile )
                // 如果存在于需要编译的 map 中，则放入 write 数组
                const targetFile = translateMap.get( changeFile );
                console.log( 'targetFile -> ', targetFile )
                if ( targetFile ) {
                    console.log( 'targetFile === changeFile -> ', targetFile === changeFile )
                    writeFiles.add( targetFile );
                    if ( targetFile === changeFile ) {
                        return ;
                    } else {
                        copyFiles.add( changeFile );
                        // return ;
                    }
                }
                // 否则从不需要编译 map 和正常文件列表中依次取，放入 copy 数组中
                const normalFile = normalMap.get( changeFile );
                if ( normalFile ) {
                    copyFiles.add( changeFile )
                    copyFiles.add( normalFile )
                }
                const modifyFile = modification.find( m => m.sourceAbsolutePath === changeFile.sourceAbsolutePath);
                if ( modifyFile ) {
                    copyFiles.add( modifyFile );
                }
                // const _targetFile = normalMap.get( changeFile ) || modification.find( m => m.sourceAbsolutePath === changeFile.sourceAbsolutePath);
                // _targetFile && copyFiles.push( _targetFile );
                // console.log( 'copy -> ', copyFiles )
            });

        } else {
            // 第一次编译
            // 将不需要翻译的文件全部放入 copy 数组中
            copyFiles = new Set([ ...onlyCopy, ...modification, ...this.getCopyMapFiles( normalMap ) ])
            // 将需要翻译的文件放入 write 数组中
            this.getWriteMapFiles( translateMap, writeFiles, copyFiles );
        }

        await this.copyFiles( copyFiles );
        await this.writeFiles( writeFiles );
    }

    async copyFiles ( files: Set<FileResource> ) {
        files.forEach( async file => {
            await copyFile( file.sourceAbsolutePath, file.distAbsolutePath );
        });
    }

    async writeFiles ( files: Set<FileResource> ) {
        files.forEach( async file => {
            await writeFile( file.distAbsolutePath, file.sourceCode );
        });
    }
}