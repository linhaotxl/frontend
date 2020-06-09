import { GlobbyPathPlugin } from './GlobbyPathPlugin';
// import NodeModulesPlugin from './NodeModulesPlugin';
import { TranslatePlugin } from './TranslatePlugin';
import { GenerateDistPlugin } from './GenerateDistPlugin';
import { TranslateTSPlugin } from './TranslateTSPlugin';
import { ClearOutputFilePlugin } from './ClearOutputFilePlugin';

export const DefaultPlugins = [
    GlobbyPathPlugin,
    TranslateTSPlugin,
    TranslatePlugin,
    // NodeModulesPlugin,
    ClearOutputFilePlugin,
    GenerateDistPlugin
];