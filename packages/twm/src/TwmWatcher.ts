import { AsyncSeriesWaterfallHook, AsyncSeriesHook } from 'tapable';

import { DefaultPlugins } from './plugins/DefaultPlugins';
import { ContextResource } from './Resource/ContextResource';
import { FileWatcher } from './helper/FileWatcher';
import { JS, TS } from './helper/Extension';

import { absolutePath, joinPath } from './utils/PathUtils';
import { ELang } from './utils/Build';

export type TwmOptions = {
    inputPath: string;
    outputPath: string
    extensions?: IExtension[]
    lang: string;
    buildPath: string;
};

export interface IMiddleware {
    apply: ( twm: Twm, context: ContextResource ) => void;
}

export default class Twm {

    defaultOptions = {
        extensions: [ JS ],

    };
    hooks = {
        globbyFileHooks: new AsyncSeriesHook([ 'context' ]),
        changeFileHooks: new AsyncSeriesWaterfallHook([ 'context', 'filePath' ]),
        clearFileHooks: new AsyncSeriesHook([ 'context' ])
    };
    fileWatcher: FileWatcher = null;

    context: ContextResource = null;
    translateHooks = new AsyncSeriesWaterfallHook([ 'context' ]);

    constructor ( options: TwmOptions ) {
        this.context = this.initialOptions( options );
        this.applySinglePlugins( DefaultPlugins );
    }

    initialOptions ({ inputPath, outputPath, extensions = [], buildPath, lang }: TwmOptions ) {
        lang === ELang.TS && this.defaultOptions.extensions.push( TS );

        const options = new ContextResource();
        options.set( 'inputPath', absolutePath( inputPath ) );
        options.set( 'outputPath', absolutePath( outputPath ) );
        options.set( 'buildPath', joinPath( inputPath, buildPath ) );
        options.set( 'lang', lang );
        options.set( 'extensions', [ ...this.defaultOptions.extensions, ...extensions ] );

        return options;
    }

    applySinglePlugins ( defaultPlugins: any[] ) {
        defaultPlugins.forEach( PluginCtor => {
            const plugin = new PluginCtor();
            plugin.apply( this );
        });
    }

    async start () {
        await this.hooks.globbyFileHooks.promise( this.context );
        await this.hooks.clearFileHooks.promise( this.context );
        await this.hooks.changeFileHooks.promise( this.context );
        this.initialFileWatcher();
    }

    initialFileWatcher () {
        this.fileWatcher = new FileWatcher( {}, this.context );
        this.fileWatcher.onAggregated( async changes => {
            const { fileResources } = this.context;
            const changeFileResources = changes.map( path => fileResources.find( resource => resource.sourceAbsolutePath === path ));
            await this.updateFiles( changeFileResources );
        });
    }

    updateFiles ( fileResources: FileResource[] ) {
        return this.hooks.changeFileHooks.promise( this.context, fileResources )
    }
}
