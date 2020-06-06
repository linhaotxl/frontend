#!/usr/bin/env node
import path from 'path';
import { argv } from 'yargs';
import Twm from '../TwmWatcher';
import { ELang, EPath } from '../utils/Build';

// import { AsyncSeriesWaterfallHook } from 'tapable';

// JS
//  translateFiles: root/pages/**.ext

// TS
//  translateFiles: root/miniprogram/pages/**.ext

const rootJS = path.join( process.cwd(), '../testtwmjs' );
const inputPathJS = path.join( rootJS );
const outputPathJS = path.join( rootJS, 'dist' );
const langJS = ELang.JS;
const pageJS = EPath[ langJS ];

const rootTS = path.join( process.cwd(), '../testtwm' );
const inputPathTS = path.join( rootTS );
const outputPathTS = path.join( rootTS, 'dist' );
const langTS = ELang.TS;
const pageTS = EPath[ langTS ];

function main () {
    const { src, output } = argv;
    new Twm({
        inputPath: inputPathTS,
        outputPath: outputPathTS,
        lang: langTS,
        buildPath: pageTS
    }).start();
}

main();