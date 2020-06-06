import Twm, { IMiddleware } from '../TwmWatcher';

/**
 * @param { string } path 解析的路径 文件 和 目录两种情况
 * @param { string } ext  解析文件的扩展名 .js
 * @param { function } translate  解析的具体步骤，怎么解析
 */
export class TranslatePlugin implements IMiddleware {

    apply ( twm: Twm ) {
        twm.hooks.changeFileHooks.tapPromise( 'TranslateFile', ( context: ContextResource, fileResources: FileResource[] ) => new Promise( resolve => {
            this.resolveTranslateFile( context, fileResources );
            resolve( context );
        }));
    }

    /**
     * 解析要翻译的文件
     */
    resolveTranslateFile ( context: ContextResource, fileResource: FileResource[] ) {
        const { fileResourceMap: { translateMap }, extensions } = context;

        // 如果存在修改的文件，则只处理修改的文件
        if ( Array.isArray( fileResource ) && fileResource.length ) {
            fileResource.forEach( async source => { // ts
                const target = translateMap.get( source );
                if ( target ) {
                    await this._translateFile( context, source, target, extensions )
                }
            });
            return ;
        }

        // 处理全部扫描到的文件
        translateMap.forEach( async ( value, key ) => {    // ts -> js
            await this._translateFile( context, key, value, extensions )
        });
    }

    async _translateFile (
        context: ContextResource,
        source: FileResource,
        target: FileResource,
        extensions: IExtension[]
    ) {
        const extname = source.extname;
        const e = extensions.find( e => e.extname === extname );
        await e.translate( context, source, target );
    }
}