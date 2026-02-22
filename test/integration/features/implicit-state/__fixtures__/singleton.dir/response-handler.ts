import { Logger } from './logger';

export const logResponse = () => {
  const logger = Logger.getInstance();
  logger.info('response sent');
};
