from importlib import import_module
from pkgutil import iter_modules

from fastapi import APIRouter


def discover_routers() -> tuple[APIRouter, ...]:
    routers = []

    for module_info in iter_modules(__path__):
        module = import_module(f"{__name__}.{module_info.name}")
        router = getattr(module, "router", None)

        if isinstance(router, APIRouter):
            routers.append(router)

    return tuple(routers)


ROUTERS = discover_routers()
