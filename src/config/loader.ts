import { readFileSync } from 'fs';
import yaml from 'js-yaml';
const parseYaml = yaml.load.bind(yaml);
import { McEnvConfig, validateConfig } from './schema.js';

export function loadConfig(filePath: string): McEnvConfig {
  let raw: unknown;
  const content = readFileSync(filePath, 'utf8');

  if (filePath.endsWith('.json')) {
    raw = JSON.parse(content);
  } else {
    raw = parseYaml(content);
  }

  return validateConfig(raw);
}
