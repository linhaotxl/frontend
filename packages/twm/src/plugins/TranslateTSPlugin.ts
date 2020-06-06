import { execSync } from 'child_process';
import Twm, { IMiddleware } from "../TwmWatcher";
import { ContextResource } from '../Resource/ContextResource';
import { ELang } from '../utils/Build';
import { joinPath } from '../utils/PathUtils';

export class TranslateTSPlugin implements IMiddleware {
    apply ( twm: Twm ) {
        twm.hooks.changeFileHooks.tapPromise( 'TranslateTS', ( context: ContextResource, fileResources: FileResource[] ) => new Promise( resolve => {
            if ( Array.isArray( fileResources ) && fileResources.length ) {
                if ( fileResources.some( f => f.extname === '.ts' ) ) {
                    this.execTSCCommand( context );
                }
            } else if ( context.lang === ELang.TS ) {
                this.execTSCCommand( context );
            }
            resolve();
        }));
    }

    execTSCCommand ( context: ContextResource ) {
        const { inputPath } = context;
        const tsConfigPath: string = joinPath( inputPath, 'tsconfig.json' );
        const cmd: string = `node ${ inputPath }/node_modules/typescript/lib/tsc.js -p ${ tsConfigPath }`;
        try {
            execSync( cmd );
        } catch ( e ) {
            console.log( 'err -> ', e.message )
        }
    }
}