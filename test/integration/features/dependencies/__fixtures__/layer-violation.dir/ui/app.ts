import { svc } from '../domain/service';
import { widget } from './widget';

const boot = (): unknown => [svc(), widget()];

boot();
