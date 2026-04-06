import type { SvgBounds, SvgPathEntry } from "./cache";

export function computePathBounds(d: string): SvgBounds | undefined {
  const numbers: number[] = [];
  const numRegex = /-?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?/g;
  let match;
  while ((match = numRegex.exec(d)) !== null) {
    numbers.push(parseFloat(match[0]));
  }

  if (numbers.length < 2) return undefined;

  let x = 0,
    y = 0;
  let startX = 0,
    startY = 0;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let numIdx = 0;

  function updateBounds(px: number, py: number) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }

  let i = 0;
  while (i < d.length) {
    const cmdMatch = d.slice(i).match(/[MLHVCSQTAZ]/i);
    if (!cmdMatch) break;
    const cmd = cmdMatch[0];
    const isRelative = cmd >= "a" && cmd <= "z";
    const ucmd = cmd.toUpperCase();

    i = d.indexOf(cmd, i) + 1;

    switch (ucmd) {
      case "M": {
        x = numbers[numIdx++];
        y = numbers[numIdx++];
        startX = x;
        startY = y;
        updateBounds(x, y);
        while (numIdx + 1 < numbers.length && d.slice(i).match(/^-?[.\d]/)) {
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "L": {
        while (numIdx + 1 < numbers.length) {
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "H": {
        while (numIdx < numbers.length) {
          x = numbers[numIdx++];
          if (isRelative) x += startX;
          updateBounds(x, y);
        }
        break;
      }
      case "V": {
        while (numIdx < numbers.length) {
          y = numbers[numIdx++];
          if (isRelative) y += startY;
          updateBounds(x, y);
        }
        break;
      }
      case "C": {
        while (numIdx + 5 < numbers.length) {
          let cx1 = numbers[numIdx++];
          let cy1 = numbers[numIdx++];
          if (isRelative) {
            cx1 += startX;
            cy1 += startY;
          }
          updateBounds(cx1, cy1);
          let cx2 = numbers[numIdx++];
          let cy2 = numbers[numIdx++];
          if (isRelative) {
            cx2 += startX;
            cy2 += startY;
          }
          updateBounds(cx2, cy2);
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "Q": {
        while (numIdx + 3 < numbers.length) {
          let cx = numbers[numIdx++];
          let cy = numbers[numIdx++];
          if (isRelative) {
            cx += startX;
            cy += startY;
          }
          updateBounds(cx, cy);
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "S": {
        while (numIdx + 3 < numbers.length) {
          let cx = numbers[numIdx++];
          let cy = numbers[numIdx++];
          if (isRelative) {
            cx += startX;
            cy += startY;
          }
          updateBounds(cx, cy);
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "T": {
        while (numIdx + 1 < numbers.length) {
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "A": {
        while (numIdx + 6 < numbers.length) {
          numIdx += 7;
          x = numbers[numIdx - 2];
          y = numbers[numIdx - 1];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "Z": {
        x = startX;
        y = startY;
        updateBounds(x, y);
        break;
      }
    }
    startX = x;
    startY = y;
  }

  if (minX === Infinity) return undefined;

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function computeBoundsFromPaths(
  paths: Array<{ d: string; fillRule?: string }>,
): SvgBounds | undefined {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let hasPoints = false;

  for (const path of paths) {
    const bounds = computePathBounds(path.d);
    if (bounds) {
      hasPoints = true;
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
  }

  if (!hasPoints) return undefined;

  const width = maxX - minX;
  const height = maxY - minY;
  const paddingX = width * 0.01;
  const paddingY = height * 0.01;

  return {
    x: Math.max(0, minX - paddingX),
    y: Math.max(0, minY - paddingY),
    width: width + paddingX * 2,
    height: height + paddingY * 2,
  };
}

export function transformPath(
  d: string,
  transform: [number, number, number, number, number, number],
): string {
  const [a, b, c, d_val, tx, ty] = transform;

  function transformPoint(x: number, y: number): [number, number] {
    return [a * x + c * y + tx, b * x + d_val * y + ty];
  }

  function transformX(x: number, y: number): number {
    return a * x + c * y + tx;
  }

  function transformY(x: number, y: number): number {
    return b * x + d_val * y + ty;
  }

  function formatNum(n: number): string {
    return Number(n.toFixed(4)).toString();
  }

  const tokens: string[] = [];
  let i = 0;

  function nextNumber(): number | undefined {
    skipWhitespace();
    const slice = d.slice(i);
    const match = slice.match(/^-?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?/);
    if (!match) return undefined;
    i += match[0].length;
    return parseFloat(match[0]);
  }

  function skipWhitespace() {
    const slice = d.slice(i);
    const match = slice.match(/^[\s,]+/);
    if (match) i += match[0].length;
  }

  while (i < d.length) {
    skipWhitespace();
    if (i >= d.length) break;

    const cmdChar = d[i];
    if (/[MLHVCSQTAZ]/i.test(cmdChar)) {
      const cmd = cmdChar;
      const isRelative = cmd >= "a" && cmd <= "z";
      const ucmd = cmd.toUpperCase();
      tokens.push(cmd);
      i++;

      let x = 0,
        y = 0;
      let startX = 0,
        startY = 0;

      switch (ucmd) {
        case "M": {
          const x1 = nextNumber();
          const y1 = nextNumber();
          if (x1 !== undefined && y1 !== undefined) {
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newX), formatNum(newY));
            x = isRelative ? x + x1 : x1;
            y = isRelative ? y + y1 : y1;
            startX = x;
            startY = y;
          }
          let x2 = nextNumber();
          let y2 = nextNumber();
          while (x2 !== undefined && y2 !== undefined) {
            if (isRelative) {
              x2 = x + x2;
              y2 = y + y2;
            }
            const [newX, newY] = transformPoint(x2, y2);
            tokens.push(formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            x2 = nextNumber();
            y2 = nextNumber();
          }
          break;
        }
        case "L": {
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (x1 !== undefined && y1 !== undefined) {
            if (isRelative) {
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "H": {
          let x1 = nextNumber();
          while (x1 !== undefined) {
            if (isRelative) {
              x1 = x + x1;
            }
            const newX = transformX(x1, y);
            tokens.push(formatNum(newX));
            x = newX;
            x1 = nextNumber();
          }
          break;
        }
        case "V": {
          let y1 = nextNumber();
          while (y1 !== undefined) {
            if (isRelative) {
              y1 = y + y1;
            }
            const newY = transformY(x, y1);
            tokens.push(formatNum(newY));
            y = newY;
            y1 = nextNumber();
          }
          break;
        }
        case "C": {
          let cx1 = nextNumber();
          let cy1 = nextNumber();
          let cx2 = nextNumber();
          let cy2 = nextNumber();
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (
            cx1 !== undefined &&
            cy1 !== undefined &&
            cx2 !== undefined &&
            cy2 !== undefined &&
            x1 !== undefined &&
            y1 !== undefined
          ) {
            if (isRelative) {
              cx1 = x + cx1;
              cy1 = y + cy1;
              cx2 = x + cx2;
              cy2 = y + cy2;
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newCx1, newCy1] = transformPoint(cx1, cy1);
            const [newCx2, newCy2] = transformPoint(cx2, cy2);
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(
              formatNum(newCx1),
              formatNum(newCy1),
              formatNum(newCx2),
              formatNum(newCy2),
              formatNum(newX),
              formatNum(newY),
            );
            x = newX;
            y = newY;
            cx1 = nextNumber();
            cy1 = nextNumber();
            cx2 = nextNumber();
            cy2 = nextNumber();
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "S": {
          let cx2 = nextNumber();
          let cy2 = nextNumber();
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (cx2 !== undefined && cy2 !== undefined && x1 !== undefined && y1 !== undefined) {
            if (isRelative) {
              cx2 = x + cx2;
              cy2 = y + cy2;
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newCx2, newCy2] = transformPoint(cx2, cy2);
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newCx2), formatNum(newCy2), formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            cx2 = nextNumber();
            cy2 = nextNumber();
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "Q": {
          let cx = nextNumber();
          let cy = nextNumber();
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (cx !== undefined && cy !== undefined && x1 !== undefined && y1 !== undefined) {
            if (isRelative) {
              cx = x + cx;
              cy = y + cy;
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newCx, newCy] = transformPoint(cx, cy);
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newCx), formatNum(newCy), formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            cx = nextNumber();
            cy = nextNumber();
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "T": {
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (x1 !== undefined && y1 !== undefined) {
            if (isRelative) {
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "A": {
          let rx = nextNumber();
          let ry = nextNumber();
          let rot = nextNumber();
          let largeArc = nextNumber();
          let sweep = nextNumber();
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (
            rx !== undefined &&
            ry !== undefined &&
            rot !== undefined &&
            largeArc !== undefined &&
            sweep !== undefined &&
            x1 !== undefined &&
            y1 !== undefined
          ) {
            if (rx === null) rx = 0;
            if (ry === null) ry = 0;
            tokens.push(formatNum(rx), formatNum(ry));
            if (rot !== undefined) tokens.push(formatNum(rot));
            if (largeArc !== undefined) tokens.push(String(largeArc));
            if (sweep !== undefined) tokens.push(String(sweep));
            if (isRelative) {
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            rx = nextNumber();
            ry = nextNumber();
            rot = nextNumber();
            largeArc = nextNumber();
            sweep = nextNumber();
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "Z": {
          x = startX;
          y = startY;
          break;
        }
      }
    } else {
      tokens.push(d[i]);
      i++;
    }
  }

  return tokens.join(" ");
}

function roundCoord(num: number): string {
  return Number(num.toFixed(4)).toString();
}

export function roundPathCoordinates(d: string): string {
  return d.replace(/-?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?/g, (match) => {
    const num = parseFloat(match);
    if (isNaN(num)) return match;
    return roundCoord(num);
  });
}

export function buildSvgContent(
  paths: Array<{ d: string; fillRule?: string }>,
  bounds?: SvgBounds,
): string {
  const pathElements = paths
    .map((p) => {
      const fillRuleAttr = p.fillRule ? ` fill-rule="${p.fillRule}"` : "";
      return `  <path d="${p.d}"${fillRuleAttr} />`;
    })
    .join("\n");

  const viewBoxAttr = bounds
    ? ` viewBox="${bounds.x.toFixed(2)} ${bounds.y.toFixed(2)} ${bounds.width.toFixed(2)} ${bounds.height.toFixed(2)}"`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg"${viewBoxAttr} fill="currentColor">\n${pathElements}\n</svg>\n`;
}

export function buildSvgContentWithFills(
  paths: Array<{ d: string; fillRule?: string; fillColor?: string }>,
  bounds?: SvgBounds,
): string {
  const pathElements = paths
    .map((p) => {
      const fillRuleAttr = p.fillRule ? ` fill-rule="${p.fillRule}"` : "";
      const fillAttr = p.fillColor ? ` fill="${p.fillColor}"` : "";
      return `  <path d="${p.d}"${fillAttr}${fillRuleAttr} />`;
    })
    .join("\n");

  let svgAttrs = 'xmlns="http://www.w3.org/2000/svg"';
  if (bounds) {
    svgAttrs += ` width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}" viewBox="0 0 ${Math.ceil(bounds.width)} ${Math.ceil(bounds.height)}"`;
  }

  return `<svg ${svgAttrs}>\n${pathElements}\n</svg>\n`;
}

export function buildSvgContentFromEntries(entries: SvgPathEntry[], bounds?: SvgBounds): string {
  const allPaths: Array<{ d: string; fillRule?: string; fillColor?: string }> = [];

  for (const entry of entries) {
    if (!entry.paths) continue;

    for (const pathObj of entry.paths) {
      if (!pathObj.d) continue;

      let d = pathObj.d;
      if (entry.transform) {
        d = transformPath(d, entry.transform);
      }
      d = roundPathCoordinates(d);

      allPaths.push({
        d,
        fillRule: pathObj.fillRule,
        fillColor: pathObj.fillColor,
      });
    }
  }

  return buildSvgContentWithFills(allPaths, bounds);
}
