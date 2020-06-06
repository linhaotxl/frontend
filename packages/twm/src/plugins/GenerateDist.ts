import generator from '@babel/generator';
import t from '@babel/types';

import { writeFile } from '../utils/FsUtils';
import Twm, { IMiddleware } from "../TwmWatcher";
import { ContextResource } from '../Resource/ContextResource';

export default class GenerateDist implements IMiddleware {
    apply ( twm: Twm ) {
        twm.translateHooks.tapPromise( 'GenerateCode', ( context: ContextResource ) => new Promise( resolve => { 
            const { fileResourceMap } = context; 
            this.generateCodeWithResource( fileResourceMap ); 
            resolve( context );
        }));
    }

    generateCodeWithResource ( fileResourceMap: FileResourceMap ) {
        Object.keys( fileResourceMap ).forEach( path => {
            const resource = fileResourceMap.resolve[ path ];
            const sourceCode = this.generateCodeWithAst( resource.ast );
            resource.sourceCode = sourceCode;

            this.copyFileToOutput( resource );
        });
    }

    generateCodeWithAst ( ast: t.File ) {
        return generator( ast ).code;
    }

    async copyFileToOutput ( fileResource: FileResource ) {
        const { distAbsolutePath: path, sourceCode: code } = fileResource;
        await writeFile( path, code );
    }
}