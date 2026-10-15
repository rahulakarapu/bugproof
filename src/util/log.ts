const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const wrap = (code: string) => (text: string) => (useColor ? `\u001B[${code}m${text}\u001B[0m` : text);

export const color = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
};

export const log = {
  plain(message = ''): void {
    console.log(message);
  },
  heading(message: string): void {
    console.log(`\n${color.bold(message)}`);
  },
  step(message: string): void {
    console.log(`${color.cyan('›')} ${message}`);
  },
  ok(message: string): void {
    console.log(`${color.green('✓')} ${message}`);
  },
  fail(message: string): void {
    console.log(`${color.red('✗')} ${message}`);
  },
  warn(message: string): void {
    console.log(`${color.yellow('!')} ${message}`);
  },
  detail(message: string): void {
    console.log(`  ${color.dim(message)}`);
  },
};

export function fatal(message: string): never {
  console.error(`${color.red('✗')} ${message}`);
  process.exit(1);
}
