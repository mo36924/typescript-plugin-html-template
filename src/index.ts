import cssnano from "cssnano";
import advanced from "cssnano-preset-advanced";
import { transformSync } from "esbuild";
import { Options, minify } from "html-minifier";
import postcss from "postcss";
import postcssImport from "postcss-import-sync2";
import nested from "postcss-nested";
import ts, { Node, SourceFile, TransformerFactory } from "typescript";
import { properties } from "../node_modules/css-declaration-sorter/orders/alphabetical.mjs";

export type { Options };

export default (options?: Options): TransformerFactory<SourceFile> => {
  const transformCss = (path: string, css: string) =>
    postcss([
      postcssImport(),
      nested(),
      cssnano({
        preset: [
          advanced,
          { cssDeclarationSorter: { order: (a: string, b: string) => properties.indexOf(a) - properties.indexOf(b) } },
        ],
      }),
    ]).process(css, { from: path }).css;

  const transformHtml = (path: string, html: string) =>
    minify(html, {
      collapseBooleanAttributes: true,
      collapseInlineTagWhitespace: true,
      collapseWhitespace: true,
      decodeEntities: true,
      removeComments: true,
      sortAttributes: true,
      sortClassName: true,
      minifyCSS: (text) => transformCss(path, text),
      minifyJS: (text) => transformSync(text, { minify: true }).code,
      ...options,
    });

  return (context) => (sourceFile) =>
    ts.visitNode(sourceFile, function visitor(node): Node {
      node = ts.visitEachChild(node, visitor, context);

      if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === "html") {
        if (ts.isNoSubstitutionTemplateLiteral(node.template)) {
          return context.factory.createTaggedTemplateExpression(
            node.tag,
            node.typeArguments,
            context.factory.createNoSubstitutionTemplateLiteral(transformHtml(sourceFile.fileName, node.template.text)),
          );
        }

        const sourceCode = sourceFile.text;
        const prefix = "_".repeat(sourceCode.length);
        const { head, templateSpans } = node.template;

        const html = transformHtml(
          sourceFile.fileName,
          templateSpans.reduce(
            (previous, current, i) => `${previous}${prefix}${i}${prefix}${current.literal.text}`,
            head.text,
          ),
        );

        const parts = html.split(new RegExp(`${prefix}(\\d+)${prefix}`, "g"));
        const [headText, ...templateTexts] = parts.filter((_, i) => !(i % 2));
        const expressions = parts.filter((_, i) => i % 2).map((i) => templateSpans[Number(i)].expression);

        if (templateSpans.length !== templateTexts.length) {
          throw new Error("Invalid html template strings array.");
        }

        return context.factory.createTaggedTemplateExpression(
          node.tag,
          node.typeArguments,
          context.factory.createTemplateExpression(
            context.factory.createTemplateHead(headText),
            templateTexts.map((text, i) =>
              context.factory.createTemplateSpan(
                expressions[i],
                i === templateTexts.length - 1
                  ? context.factory.createTemplateTail(text)
                  : context.factory.createTemplateMiddle(text),
              ),
            ),
          ),
        );
      }

      return node;
    });
};
