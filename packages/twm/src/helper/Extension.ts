import { TranslateJsHelper } from './TranslateJsHelper';

export const TS: IExtension = {
    extname: '.ts',
    replace: '.js',
    translate: TranslateJsHelper
};

export const JS: IExtension = {
    extname: '.js',
    translate: TranslateJsHelper
};