#!/bin/sh
# Filtro de entrada de Doxygen (ver FILTER_PATTERNS en Doxyfile). Solo cambia lo que Doxygen analiza: el código
# que muestra el sitio es el original. Conserva la cantidad de líneas para que los números coincidan.
#
# Doxygen solo reconoce `self.metodo()` como llamada a un método de la clase. En este módulo lo habitual es
# `for r in self: r.action_x()` o `t._transition(...)`, así que las variables de bucle más usadas se reemplazan por
# `self.` para que esas llamadas aparezcan en los grafos.
case "$1" in
    *.py) exec sed -E 's/\b(f|r|a|v|t|ln|rec|req|rel|cr|task|finding|release)\.(action_|_after_|_check_|_schedule|_transition|_is_|_notify|_recompute|_my_|_planner|_area)/self.\2/g' "$1" ;;
    *) exec cat "$1" ;;
esac
