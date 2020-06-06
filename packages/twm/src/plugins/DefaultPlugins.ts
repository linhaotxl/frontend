import { GlobbyPathPlugin } from './GlobbyPathPlugin';
// import NodeModulesPlugin from './NodeModulesPlugin';
import { TranslatePlugin } from './TranslatePlugin';
// import GenerateDist from './GenerateDist';
import { CopyFilePlugin } from './CopyFilePlugin';
import { TranslateTSPlugin } from './TranslateTSPlugin';
import { ClearOutputFilePlugin } from './ClearOutputFilePlugin';

export const DefaultPlugins = [
    GlobbyPathPlugin,
    TranslateTSPlugin,
    TranslatePlugin,
    // NodeModulesPlugin,
    // GenerateDist,
    ClearOutputFilePlugin,
    CopyFilePlugin
];